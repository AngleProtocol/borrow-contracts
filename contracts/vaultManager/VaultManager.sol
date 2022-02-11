// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.10;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/IERC721ReceiverUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/interfaces/IERC721MetadataUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/introspection/IERC165Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/AddressUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/CountersUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../interfaces/IAgToken.sol";
import "../interfaces/IFlashLoanCallee.sol";
import "../interfaces/IOracle.sol";
import "../interfaces/ITreasury.sol";
import "../interfaces/IVaultManager.sol";

// TODO split in multiple files and leave some space each time for upgradeability -> check how we can leverage libraries this time
// TODO reentrancy calls here -> should we put more and where to make sure we are not vulnerable to hacks here
// TODO check trade-off 10**27 and 10**18 for interest accumulated
// TODO check liquidationBooster depending on veANGLE with like a veANGLE delegation feature
// TODO add returns to functions
// TODO think of more view functions
// TODO liquidations for vaults which have just been created
// TODO recoverERC20?

/// @title VaultManager
/// @author Angle Core Team
/// @notice This contract allows people to deposit collateral and open up loans of a given AgToken. It handles all the loan
/// logic (fees and interest rate) as well as the liquidation logic
/// @dev This implementation only supports non-rebasing ERC20 tokens as collateral
/// @dev This contract is encoded as a NFT contract
// solhint-disable-next-line max-states-count
contract VaultManager is
    Initializable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable,
    IERC721MetadataUpgradeable,
    IVaultManager
{
    using SafeERC20 for IERC20;
    using CountersUpgradeable for CountersUpgradeable.Counter;
    using Address for address;

    /// @notice Base used for parameter computation
    uint256 public constant BASE_PARAMS = 10**9;
    /// @notice Base used for interest rate computation
    uint256 public constant BASE_INTEREST = 10**27;

    // ================================ Key Structs ================================

    /// @notice Parameters associated to a given `VaultManager` contract: these all correspond
    /// to parameters which signification is detailed below
    struct VaultParameters {
        uint256 dust;
        uint256 dustCollateral;
        uint256 debtCeiling;
        uint64 collateralFactor;
        uint64 targetHealthFactor;
        uint64 borrowFee;
        uint64 interestRate;
        uint64 liquidationSurcharge;
        uint64 maxLiquidationDiscount;
        uint64 liquidationBooster;
        bool whitelistingActivated;
    }

    /// @notice Data stored to track someone's loan (or equivalently called position)
    struct Vault {
        // Amount of collateral deposited in the vault
        uint256 collateralAmount;
        // Normalized value of the debt (that is to say of the stablecoins borrowed)
        uint256 normalizedDebt;
    }

    /// @notice For a given `vaultID`, this encodes a liquidation opportunity that is to say details about the maximul
    /// amount that could be repaid by liquidating the position
    /// @dev All the values are null in the case of a vault which cannot be liquidated under these conditions
    struct LiquidationOpportunity {
        // Maximum stablecoin amount that can be repaid upon liquidating the vault
        uint256 maxStablecoinAmountToRepay;
        // Collateral amount given to the person in the case where the maximum amount to repay is given
        uint256 maxCollateralAmountGiven;
        // Threshold value of stablecoin amount to repay: it is ok for a liquidator to repay below threshold,
        // but if this threshold is non null and the liquidator wants to repay more than threshold, it should repay
        // the max stablecoin amount given in this vault
        uint256 thresholdRepayAmount;
        // Discount proposed to the liquidator on the collateral
        uint256 discount;
        // Amount of debt in the vault
        uint256 currentDebt;
    }

    /// @notice Data stored during a liquidation process to keep in memory what's due to a liquidator and some
    /// essential data for vaults being liquidated
    struct LiquidatorData {
        // Current amount of stablecoins the liquidator should give to the contract
        uint256 stablecoinAmountToReceive;
        // Current amount of collateral the contract should give to the liquidator
        uint256 collateralAmountToGive;
        // Bad debt accrued across the liquidation process
        uint256 badDebtFromLiquidation;
        // Oracle value at the time of the liquidation
        uint256 oracleValue;
        // Value of the interestRateAccumulator at the time of the call
        uint256 newInterestRateAccumulator;
    }

    /// @notice Data to track during a series of action the amount to give or receive in stablecoins and collateral
    /// to the caller or associated addresses
    struct PaymentData {
        // Stablecoin amount the contract should give
        uint256 stablecoinAmountToGive;
        // Stablecoin amount owed to the contract
        uint256 stablecoinAmountToReceive;
        // Collateral amount the contract should give
        uint256 collateralAmountToGive;
        // Collateral amount owed to the contract
        uint256 collateralAmountToReceive;
    }

    // ================================ Mappings ===================================

    /// @notice Maps an address to whether it's whitelisted and can open or own a vault
    mapping(address => bool) public isWhitelisted;
    /// @notice Maps a `vaultID` to its data (namely collateral amount and normalized debt)
    mapping(uint256 => Vault) public vaultData;

    // =============================== References ==================================

    /// @inheritdoc IVaultManager
    ITreasury public override treasury;
    /// @notice Reference to the collateral handled by this `VaultManager`
    IERC20 public collateral;
    /// @notice Stablecoin handled by this contract. Another `VaultManager` contract could have
    /// the same rights as this `VaultManager` on the stablecoin contract
    IAgToken public stablecoin;
    /// @notice Oracle contract to get access to the price of the collateral with respect to the stablecoin
    IOracle public oracle;
    /// @notice Base of the collateral
    uint256 public collatBase;

    // =============================== Parameters ==================================

    /// @notice Minimum amount of debt a vault can have
    uint256 public dust;
    /// @notice Maximum amount of stablecoins that can be issued with this contract
    uint256 public debtCeiling;
    /// @notice Minimum amount of collateral (in stablecoin value) that can be left in a vault during a liquidation
    /// where the health factor function is decreasing
    uint256 public dustCollateral;
    /// @notice Encodes the minimum ratio collateral/stablecoin a vault can have before being liquidated. It's what
    /// determines the minimum collateral ratio of a position
    uint64 public collateralFactor;
    /// @notice Maximum Health factor at which a vault can end up after a liquidation (unless it's fully liquidated)
    uint64 public targetHealthFactor;
    /// @notice Upfront fee taken when borrowing stablecoins
    uint64 public borrowFee;
    /// @notice Per second interest taken to borrowers taking agToken loans
    uint64 public interestRate;
    /// @notice Fee taken by the protocol during a liquidation. Technically, this value is not the fee per se, it's 1 - fee.
    /// For instance for a 2% fee, `liquidationSurcharge` should be 98%
    uint64 public liquidationSurcharge;
    /// @notice Maximum discount given to liquidators
    uint64 public maxLiquidationDiscount;
    /// @notice Base liquidation booster to compute the discount
    uint64 public liquidationBooster;
    /// @notice Whether whitelisting is required to own a vault or not
    bool public whitelistingActivated;

    // =============================== Variables ===================================

    /// @notice Timestamp at which the `interestAccumulator` was updated
    uint256 public lastInterestAccumulatorUpdated;
    /// @notice Keeps track of the interest that should accrue to the protocol. The stored value
    /// is not necessarily the true value: this one is recomputed every time an action takes place
    /// within the protocol
    uint256 public interestAccumulator;
    /// @notice Total normalized amount of stablecoins borrowed
    uint256 public totalNormalizedDebt;
    /// @notice Surplus accumulated by the contract: surplus is always in stablecoins, and is then reset
    /// when the value is communicated to the treasury contract
    uint256 public surplus;
    /// @notice Bad debt made from liquidated vaults which ended up having no collateral and a positive amount
    /// of stablecoins
    uint256 public badDebt;

    // ================================ ERC721 Data ================================

    /// @notice URI
    string public baseURI;
    /// @inheritdoc IERC721MetadataUpgradeable
    string public override name;
    /// @inheritdoc IERC721MetadataUpgradeable
    string public override symbol;

    // Counter to generate a unique `vaultID` for each vault: `vaultID` acts as `tokenID` in basic ERC721
    // contracts
    CountersUpgradeable.Counter internal _vaultIDcount;

    // Mapping from `vaultID` to owner address
    mapping(uint256 => address) internal _owners;

    // Mapping from owner address to vault owned count
    mapping(address => uint256) internal _balances;

    // Mapping from `vaultID` to approved address
    mapping(uint256 => address) internal _vaultApprovals;

    // Mapping from owner to operator approvals
    mapping(address => mapping(address => bool)) internal _operatorApprovals;

    // =============================== Events ======================================

    event FiledUint64(uint64 param, bytes32 what);
    event FiledUint256(uint256 param, bytes32 what);
    event ToggledWhitelisting(bool);
    event OracleUpdated(address indexed _oracle);

    /// @notice Initializes the `VaultManager` contract
    /// @param _treasury Treasury address handling the contract
    /// @param _collateral Collateral supported by this contract
    /// @param _oracle Oracle contract used
    /// @param symbolVault Symbol used for the NFT contract
    /// @dev The parameters and the oracle are the only elements which could be modified once the
    /// contract has been initialized
    function initialize(
        ITreasury _treasury,
        IERC20 _collateral,
        IOracle _oracle,
        string memory symbolVault,
        VaultParameters calldata params
    ) public initializer {
        require(address(oracle) != address(0), "0");
        treasury = _treasury;
        collateral = _collateral;
        collatBase = 10**(IERC20Metadata(address(collateral)).decimals());
        stablecoin = IAgToken(_treasury.stablecoin());
        oracle = _oracle;

        name = string(abi.encodePacked("Angle Protocol ", symbolVault, " Vault"));
        symbol = string(abi.encodePacked(symbolVault, "-vault"));

        interestAccumulator = BASE_INTEREST;

        // Checking if the parameters have been correctly initialized
        require(
            params.collateralFactor <= params.liquidationSurcharge &&
                params.liquidationSurcharge <= BASE_PARAMS &&
                params.borrowFee <= BASE_PARAMS &&
                params.targetHealthFactor <= BASE_PARAMS &&
                params.maxLiquidationDiscount <= BASE_PARAMS,
            "15"
        );
        dust = params.dust;
        debtCeiling = params.debtCeiling;
        collateralFactor = params.collateralFactor;
        targetHealthFactor = params.targetHealthFactor;
        dustCollateral = params.dustCollateral;
        borrowFee = params.borrowFee;
        interestRate = params.interestRate;
        liquidationSurcharge = params.liquidationSurcharge;
        maxLiquidationDiscount = params.maxLiquidationDiscount;
        liquidationBooster = params.liquidationBooster;
        whitelistingActivated = params.whitelistingActivated;
        _pause();
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() initializer {}

    // ============================== Modifiers ====================================

    /// @notice Checks whether the `msg.sender` has the governor role or not
    modifier onlyGovernor() {
        require(treasury.isGovernor(msg.sender), "1");
        _;
    }

    /// @notice Checks whether the `msg.sender` has the governor role or the guardian role
    modifier onlyGovernorOrGuardian() {
        require(treasury.isGovernorOrGuardian(msg.sender), "2");
        _;
    }

    /// @notice Checks whether the `msg.sender` is the treasury contract
    modifier onlyTreasury() {
        require(msg.sender == address(treasury), "14");
        _;
    }

    /// @notice Checks if the person interacting with the vault with `vaultID` is approved
    /// @param caller Address of the person seeking to interact with the vault
    /// @param vaultID ID of the concerned vault
    modifier onlyApprovedOrOwner(address caller, uint256 vaultID) {
        require(_isApprovedOrOwner(caller, vaultID), "16");
        _;
    }

    // ============================= View Functions ================================

    /// @notice Gets the current debt of a vault
    /// @param vaultID ID of the vault to check
    /// @return Debt of the vault
    function getVaultDebt(uint256 vaultID) external view returns (uint256) {
        return vaultData[vaultID].normalizedDebt * _calculateCurrentInterestRateAccumulator();
    }

    /// @notice Gets the total debt across all vaults
    /// @return Total debt across all vaults, taking into account the interest accumulated
    /// over time
    function getTotalDebt() external view returns (uint256) {
        return totalNormalizedDebt * _calculateCurrentInterestRateAccumulator();
    }

    // =================== Internal Utility View Functions =========================

    /// @notice Verifies whether a given vault is solvent (i.e. should be liquidated or not)
    /// @param vault Data of the vault to check
    /// @param oracleValue Oracle value at the time of the call
    /// @param newInterestRateAccumulator Value of the `interestRateAccumulator` at the time of the call
    /// @return solvent Whether the vault is healthy or not
    /// @return currentDebt Current value of the debt of the vault (taking into account interest)
    /// @return collateralAmountInStable Collateral in the vault expressed in stablecoin value
    /// @return oracleValue Current value of the oracle
    /// @return newInterestRateAccumulator Current value of the `interestRateAccumulator`
    /// @dev If the oracle value or the interest rate accumulator has not been called at the time of the
    /// call, this function computes it
    function _isSolvent(
        Vault memory vault,
        uint256 oracleValue,
        uint256 newInterestRateAccumulator
    )
        internal
        view
        returns (
            bool,
            uint256,
            uint256,
            uint256,
            uint256
        )
    {
        if (oracleValue == 0) oracleValue = oracle.read();
        if (newInterestRateAccumulator == 0) newInterestRateAccumulator = _calculateCurrentInterestRateAccumulator();
        uint256 currentDebt = vault.normalizedDebt * newInterestRateAccumulator;
        uint256 collateralAmountInStable = (vault.collateralAmount * oracleValue) / collatBase;
        bool solvent = collateralAmountInStable * collateralFactor >= currentDebt * BASE_PARAMS;
        return (solvent, currentDebt, collateralAmountInStable, oracleValue, newInterestRateAccumulator);
    }

    /// @notice Calculates the current value of the `interestRateAccumulator` without updating the value
    /// in storage
    // TODO: check Aave's raymul: https://github.com/aave/protocol-v2/blob/61c2273a992f655c6d3e7d716a0c2f1b97a55a92/contracts/protocol/libraries/math/WadRayMath.sol
    // TODO: check Aave's solution wrt to Maker in terms of gas and how much it costs
    // TODO: should we have a few function on top of this
    function _calculateCurrentInterestRateAccumulator() internal view returns (uint256) {
        uint256 exp = block.timestamp - lastInterestAccumulatorUpdated;
        if (exp == 0) return interestAccumulator;
        uint256 expMinusOne = exp - 1;
        uint256 expMinusTwo = exp > 2 ? exp - 2 : 0;
        uint256 ratePerSecond = interestRate;
        uint256 basePowerTwo = ratePerSecond * ratePerSecond;
        uint256 basePowerThree = basePowerTwo * ratePerSecond;
        uint256 secondTerm = (exp * expMinusOne * basePowerTwo) / 2;
        uint256 thirdTerm = (exp * expMinusOne * expMinusTwo * basePowerThree) / 6;
        return interestAccumulator * (BASE_INTEREST + ratePerSecond * exp + secondTerm + thirdTerm);
    }

    /// @notice Creates a vault
    /// @param toVault Address for which the va
    /// @return vaultID ID of the vault created
    /// @dev This function just creates the vault without doing any collateral or
    function createVault(address toVault) external whenNotPaused returns (uint256) {
        return _createVault(toVault);
    }

    /// @notice Closes a vault
    /// @param vaultID Vault to close
    /// @param from Address from which stablecoins for the repayment of the debt should be taken
    /// @param to Address to which the collateral of the vault should be given
    /// @param who If necessary contract to call to handle the repayment of the stablecoins upon receipt
    /// of the collateral
    /// @param data Data to send to the `who` contract
    /// @dev The `from` address should have approved the `msg.sender`
    /// @dev Only the owner of the vault or an approved address for this vault can decide to close it
    /// @dev Specifying a who address along with data allows for a capital efficient closing of vaults
    /// TODO check reentrancy -> maybe in handle repay
    /// TODO check who in handle repay
    function closeVault(
        uint256 vaultID,
        address from,
        address to,
        address who,
        bytes calldata data
    ) external whenNotPaused nonReentrant {
        (uint256 currentDebt, uint256 collateralAmount, , ) = _closeVault(vaultID, 0, 0);
        _handleRepay(collateralAmount, currentDebt, from, to, who, data);
    }

    /// @notice Adds collateral in a vault
    /// @param vaultID ID of the vault to add collateral to
    /// @param collateralAmount Amount of collateral to add
    /// @dev Any address can add collateral on any vault
    function addCollateral(uint256 vaultID, uint256 collateralAmount) external whenNotPaused {
        collateral.safeTransferFrom(msg.sender, address(this), collateralAmount);
        _addCollateral(vaultID, collateralAmount);
    }

    /// @notice Removes collateral from a vault
    /// @param vaultID ID of the vault to remove collateral from
    /// @param collateralAmount Amount of collateral to remove
    /// @param to Address to send the collateral to
    /// @dev Solvency is checked after removing collateral
    /// @dev Only approved addresses can remove collateral from a vault
    function removeCollateral(
        uint256 vaultID,
        uint256 collateralAmount,
        address to
    ) external whenNotPaused {
        _removeCollateral(vaultID, collateralAmount, 0, 0);
        collateral.transfer(to, collateralAmount);
    }

    /// @notice Repays a portion of the debt of a vault
    /// @param vaultID ID of the vault for which debt should be repayed
    /// @param stablecoinAmount Amount of stablecoins
    /// @param from Address to take the stablecoins from
    /// @dev `from` should have approved the `msg.sender` for debt repayment
    /// @dev Any address can repay debt for any address
    function repayDebt(
        uint256 vaultID,
        uint256 stablecoinAmount,
        address from
    ) external whenNotPaused {
        stablecoin.burnFrom(stablecoinAmount, from, msg.sender);
        _decreaseDebt(vaultID, stablecoinAmount, 0);
    }

    /// @notice Borrows stablecoins from a vault
    /// @param vaultID ID of the vault for which stablecoins should be borrowed
    /// @param stablecoinAmount Amount of stablecoins to borrow
    /// @param to Address to which stablecoins should be sent
    /// @dev A solvency check is performed after the debt increase
    /// @dev Only approved addresses by the vault owner or the vault owner can perform this action
    function borrow(
        uint256 vaultID,
        uint256 stablecoinAmount,
        address to
    ) external whenNotPaused {
        (uint256 toMint, , ) = _borrow(vaultID, stablecoinAmount, 0, 0);
        stablecoin.mint(to, toMint);
    }

    /// @notice Gets debt in a vault from another vault potentially in another `VaultManager` contract
    /// @param srcVaultID ID of the vault from this contract for which growing debt
    /// @param vaultManager Address of the `vaultManager` where the targeted vault is
    /// @param dstVaultID ID of the vault in the target contract
    /// @param stablecoinAmount Amount of stablecoins to grow the debt of. This amount will be converted
    /// to a normalized value in both vaultManager contracts
    /// @dev A solvency check is performed after the debt increase in the source `vaultID`
    /// @dev Only approved addresses by the source vault owner can perform this action, however any vault
    /// from any vaultManager contract can see its debt reduced by this means
    function getDebtIn(
        uint256 srcVaultID,
        IVaultManager vaultManager,
        uint256 dstVaultID,
        uint256 stablecoinAmount
    ) external whenNotPaused {
        _getDebtIn(vaultManager, srcVaultID, dstVaultID, stablecoinAmount, 0, 0);
    }

    /// @inheritdoc IVaultManager
    function getDebtOut(
        uint256 vaultID,
        uint256 stablecoinAmount,
        uint256 senderBorrowFee
    ) public override whenNotPaused {
        require(treasury.isVaultManager(msg.sender));
        // Checking the delta of borrow fees to eliminate the risk of exploits here
        if (senderBorrowFee > borrowFee) {
            uint256 borrowFeePaid = ((senderBorrowFee - borrowFee) * stablecoinAmount) / BASE_PARAMS;
            stablecoinAmount -= borrowFeePaid;
            surplus += borrowFeePaid;
        }
        _decreaseDebt(vaultID, stablecoinAmount, 0);
    }

    // =============== Internal Utility State-Modifying Functions ==================

    /// @notice Internal version of the `createVault` function
    function _createVault(address toVault) internal returns (uint256 vaultID) {
        require(!whitelistingActivated || (isWhitelisted[toVault] && isWhitelisted[msg.sender]), "not whitelisted");
        _vaultIDcount.increment();
        vaultID = _vaultIDcount.current();
        _mint(toVault, vaultID);
    }

    /// @notice Closes a vault without handling the repayment of the concerned address
    /// @param vaultID ID of the vault to close
    /// @param oracleValueStart Oracle value at the start of the call: if it's 0 it's going to be computed
    /// in the `_isSolvent` function
    /// @param interestRateAccumulatorStart Interest rate accumulator value at the start of the call: if it's 0
    /// it's going to be computed in the `isSolvent` function
    /// @return Current debt of the vault to be repaid
    /// @return Value of the collateral in the vault to reimburse
    /// @return Current oracle value
    /// @return Current interest rate accumulator value
    /// @dev The returned values are here to facilitate composability between calls
    function _closeVault(
        uint256 vaultID,
        uint256 oracleValueStart,
        uint256 interestRateAccumulatorStart
    )
        internal
        onlyApprovedOrOwner(msg.sender, vaultID)
        returns (
            uint256,
            uint256,
            uint256,
            uint256
        )
    {
        Vault memory vault = vaultData[vaultID];
        // Optimize for gas here
        (bool solvent, uint256 currentDebt, , uint256 oracleValue, uint256 newInterestRateAccumulator) = _isSolvent(
            vault,
            oracleValueStart,
            interestRateAccumulatorStart
        );
        require(solvent);
        _burn(vaultID);
        return (currentDebt, vault.collateralAmount, oracleValue, newInterestRateAccumulator);
    }

    /// @notice Increases the collateral balance of a vault
    /// @param vaultID ID of the vault to increase the collateral balance of
    /// @param collateralAmount Amount by which increasing the collateral balance of
    function _addCollateral(uint256 vaultID, uint256 collateralAmount) internal {
        vaultData[vaultID].collateralAmount += collateralAmount;
    }

    /// @notice Decreases the collateral balance from a vault (without proceeding to collateral transfers)
    /// @param vaultID ID of the vault to decrease the collateral balance of
    /// @param collateralAmount Amount of collateral to reduce the balance of
    /// @param oracleValueStart Oracle value at the start of the call (given here to avoid double computations)
    /// @param interestRateAccumulatorStart Value of the interest rate accumulator (potentially zero if it has not been
    /// computed yet)
    /// @return Computed value of the oracle
    /// @return Computed value of the interest rate accumulator
    function _removeCollateral(
        uint256 vaultID,
        uint256 collateralAmount,
        uint256 oracleValueStart,
        uint256 interestRateAccumulatorStart
    ) internal onlyApprovedOrOwner(msg.sender, vaultID) returns (uint256, uint256) {
        vaultData[vaultID].collateralAmount -= collateralAmount;
        (bool solvent, , , uint256 oracleValue, uint256 newInterestRateAccumulator) = _isSolvent(
            vaultData[vaultID],
            oracleValueStart,
            interestRateAccumulatorStart
        );
        require(solvent);
        return (oracleValue, newInterestRateAccumulator);
    }

    // TODO check order with which we have to place the modifiers for it to work
    function _borrow(
        uint256 vaultID,
        uint256 stablecoinAmount,
        uint256 oracleValueStart,
        uint256 newInterestRateAccumulatorStart
    )
        internal
        onlyApprovedOrOwner(msg.sender, vaultID)
        returns (
            uint256 toMint,
            uint256 oracleValue,
            uint256 interestRateAccumulator
        )
    {
        (oracleValue, interestRateAccumulator) = _increaseDebt(
            vaultID,
            stablecoinAmount,
            oracleValueStart,
            newInterestRateAccumulatorStart
        );
        uint256 borrowFeePaid = (borrowFee * stablecoinAmount) / BASE_PARAMS;
        surplus += borrowFeePaid;
        toMint = stablecoinAmount - borrowFeePaid;
    }

    function _getDebtIn(
        IVaultManager vaultManager,
        uint256 srcVaultID,
        uint256 dstVaultID,
        uint256 stablecoinAmount,
        uint256 oracleValue,
        uint256 newInterestRateAccumulator
    ) internal onlyApprovedOrOwner(msg.sender, srcVaultID) returns (uint256, uint256) {
        // Checking if the vaultManager has been initialized
        // TODO borrow fee ->
        // TODO simplify if same vault
        require(treasury.isVaultManager(address(vaultManager)));
        vaultManager.getDebtOut(dstVaultID, stablecoinAmount, borrowFee);
        return _increaseDebt(srcVaultID, stablecoinAmount, oracleValue, newInterestRateAccumulator);
    }

    function _increaseDebt(
        uint256 vaultID,
        uint256 stablecoinAmount,
        uint256 oracleValueStart,
        uint256 newInterestRateAccumulator
    ) internal returns (uint256, uint256) {
        if (newInterestRateAccumulator == 0) newInterestRateAccumulator = _calculateCurrentInterestRateAccumulator();
        uint256 changeAmount = (stablecoinAmount * BASE_INTEREST) / newInterestRateAccumulator;
        vaultData[vaultID].normalizedDebt += changeAmount;
        totalNormalizedDebt += changeAmount;
        require(totalNormalizedDebt * newInterestRateAccumulator <= debtCeiling * BASE_INTEREST);
        (bool solvent, , , uint256 oracleValue, ) = _isSolvent(
            vaultData[vaultID],
            oracleValueStart,
            newInterestRateAccumulator
        );
        require(solvent);
        return (oracleValue, newInterestRateAccumulator);
    }

    function _decreaseDebt(
        uint256 vaultID,
        uint256 stablecoinAmount,
        uint256 newInterestRateAccumulator
    ) internal returns (uint256) {
        if (newInterestRateAccumulator == 0) newInterestRateAccumulator = _calculateCurrentInterestRateAccumulator();
        uint256 changeAmount = (stablecoinAmount * BASE_INTEREST) / newInterestRateAccumulator;
        uint256 newVaultNormalizedDebt = vaultData[vaultID].normalizedDebt - changeAmount;
        totalNormalizedDebt -= changeAmount;
        // TODO check if can be done more efficiently
        require(
            newVaultNormalizedDebt == 0 || newVaultNormalizedDebt * newInterestRateAccumulator >= dust * BASE_INTEREST
        );
        vaultData[vaultID].normalizedDebt = newVaultNormalizedDebt;
        return newInterestRateAccumulator;
    }

    function _handleRepay(
        uint256 collateralAmountToGive,
        uint256 stableAmountToRepay,
        address from,
        address to,
        address who,
        bytes calldata data
    ) internal {
        collateral.safeTransfer(to, collateralAmountToGive);
        // TODO check for which contract we need to be careful -> like do we need to add a reentrancy or to restrict the who address
        if (data.length > 0 && who != address(stablecoin)) {
            // TODO do we keep the interface here: Maker has the same, same for Abracadabra -> maybe need to do something different
            // Like flashloan callee is for sure not the right name to set here given that it's not a flash loan
            IFlashLoanCallee(who).flashLoanCallStablecoin(from, stableAmountToRepay, collateralAmountToGive, data);
        }
        stablecoin.burnFrom(stableAmountToRepay, from, msg.sender);
    }

    function _accrue() internal {
        uint256 newInterestRateAccumulator = _calculateCurrentInterestRateAccumulator();
        // TODO can change
        uint256 interestAccrued = (totalNormalizedDebt * (newInterestRateAccumulator - interestAccumulator)) /
            BASE_INTEREST;
        surplus += interestAccrued;
        interestAccumulator = newInterestRateAccumulator;
        lastInterestAccumulatorUpdated = block.timestamp;
    }

    function accrueInterestToTreasury()
        external
        override
        onlyTreasury
        returns (uint256 surplusCurrentValue, uint256 badDebtEndValue)
    {
        _accrue();
        surplusCurrentValue = surplus;
        badDebtEndValue = badDebt;
        // TODO do we still need to do it here if accounting is done in the end in the treasury
        if (surplusCurrentValue >= badDebtEndValue) {
            badDebtEndValue = 0;
            stablecoin.mint(address(treasury), surplusCurrentValue - badDebtEndValue);
        } else {
            badDebtEndValue -= surplusCurrentValue;
        }
        surplus = 0;
        // Reset to 0 once communicated to the protocol
        badDebt = 0;
    }

    uint8 public constant ACTION_CREATE_VAULT = 1;
    uint8 public constant ACTION_CLOSE_VAULT = 2;
    uint8 public constant ACTION_ADD_COLLATERAL = 3;
    uint8 public constant ACTION_REMOVE_COLLATERAL = 4;
    uint8 public constant ACTION_REPAY_DEBT = 5;
    uint8 public constant ACTION_BORROW = 6;
    uint8 public constant ACTION_GET_DEBT_IN = 7;

    // For composability of calls
    function angle(
        uint8[] memory actions,
        bytes[] memory datas,
        address from,
        address to,
        address who,
        bytes calldata data
    ) external payable whenNotPaused nonReentrant {
        uint256 newInterestRateAccumulator;
        uint256 oracleValue;
        uint256 collateralAmount;
        uint256 stablecoinAmount;
        uint256 vaultID;
        PaymentData memory paymentData;
        for (uint256 i = 0; i < actions.length; i++) {
            uint8 action = actions[i];
            if (action == ACTION_CREATE_VAULT) {
                _createVault(abi.decode(datas[i], (address)));
            } else if (action == ACTION_CLOSE_VAULT) {
                (stablecoinAmount, collateralAmount, oracleValue, newInterestRateAccumulator) = _closeVault(
                    abi.decode(datas[i], (uint256)),
                    oracleValue,
                    newInterestRateAccumulator
                );
                paymentData.collateralAmountToGive += collateralAmount;
                paymentData.stablecoinAmountToReceive += stablecoinAmount;
            } else if (action == ACTION_ADD_COLLATERAL) {
                (vaultID, collateralAmount) = abi.decode(datas[i], (uint256, uint256));
                _addCollateral(vaultID, collateralAmount);
                paymentData.collateralAmountToReceive += collateralAmount;
            } else if (action == ACTION_REMOVE_COLLATERAL) {
                (vaultID, collateralAmount) = abi.decode(datas[i], (uint256, uint256));
                (oracleValue, newInterestRateAccumulator) = _removeCollateral(
                    vaultID,
                    collateralAmount,
                    oracleValue,
                    newInterestRateAccumulator
                );
                paymentData.collateralAmountToGive += collateralAmount;
            } else if (action == ACTION_REPAY_DEBT) {
                (vaultID, collateralAmount) = abi.decode(datas[i], (uint256, uint256));
                newInterestRateAccumulator = _decreaseDebt(vaultID, collateralAmount, newInterestRateAccumulator);
                paymentData.stablecoinAmountToReceive += collateralAmount;
            } else if (action == ACTION_BORROW) {
                (vaultID, collateralAmount) = abi.decode(datas[i], (uint256, uint256));
                (stablecoinAmount, oracleValue, newInterestRateAccumulator) = _borrow(
                    vaultID,
                    collateralAmount,
                    oracleValue,
                    newInterestRateAccumulator
                );
                paymentData.stablecoinAmountToGive += stablecoinAmount;
            } else if (action == ACTION_GET_DEBT_IN) {
                address vaultManager;
                uint256 dstVaultID;
                (vaultManager, vaultID, dstVaultID, stablecoinAmount) = abi.decode(
                    datas[i],
                    (address, uint256, uint256, uint256)
                );
                (oracleValue, newInterestRateAccumulator) = _getDebtIn(
                    IVaultManager(vaultManager),
                    vaultID,
                    dstVaultID,
                    stablecoinAmount,
                    oracleValue,
                    newInterestRateAccumulator
                );
            }
        }
        if (paymentData.stablecoinAmountToReceive > paymentData.stablecoinAmountToGive) {
            uint256 stablecoinPayment = paymentData.stablecoinAmountToReceive - paymentData.stablecoinAmountToGive;
            if (paymentData.collateralAmountToGive > paymentData.collateralAmountToReceive) {
                _handleRepay(
                    paymentData.collateralAmountToGive - paymentData.collateralAmountToReceive,
                    stablecoinPayment,
                    from,
                    to,
                    who,
                    data
                );
            } else {
                stablecoin.burnFrom(stablecoinPayment, from, msg.sender);
                collateral.safeTransferFrom(
                    msg.sender,
                    address(this),
                    paymentData.collateralAmountToReceive - paymentData.collateralAmountToGive
                );
            }
        } else {
            // TODO check dest addresses
            uint256 stablecoinPayment = paymentData.stablecoinAmountToGive - paymentData.stablecoinAmountToReceive;
            stablecoin.mint(to, stablecoinPayment);
            if (paymentData.collateralAmountToGive < paymentData.collateralAmountToReceive) {
                uint256 collateralPayment = paymentData.collateralAmountToReceive - paymentData.collateralAmountToGive;
                if (data.length > 0 && who != address(collateral)) {
                    IFlashLoanCallee(who).flashLoanCallCollateral(
                        msg.sender,
                        stablecoinPayment,
                        collateralPayment,
                        data
                    );
                }
                collateral.safeTransferFrom(msg.sender, address(this), collateralPayment);
            } else {
                collateral.safeTransfer(to, paymentData.collateralAmountToGive - paymentData.collateralAmountToReceive);
            }
        }
    }

    // name of the function should be smaller to save some gas for liquidators: allows for bigger discounts
    function liquidate(
        uint256[] memory vaultIDs,
        uint256[] memory amounts,
        address from,
        address to,
        address who,
        bytes calldata data
    ) external whenNotPaused nonReentrant {
        LiquidatorData memory liqData;
        require(vaultIDs.length == amounts.length);
        liqData.oracleValue = oracle.read();
        liqData.newInterestRateAccumulator = _calculateCurrentInterestRateAccumulator();
        for (uint256 i = 0; i < vaultIDs.length; i++) {
            Vault memory vault = vaultData[vaultIDs[i]];
            LiquidationOpportunity memory liqOpp = _checkLiquidation(
                vault,
                liqData.oracleValue,
                liqData.newInterestRateAccumulator
            );
            // TODO see if the flow works for liquidators or if we should do better
            if (
                (liqOpp.maxStablecoinAmountToRepay > 0) &&
                ((liqOpp.thresholdRepayAmount == 0 && amounts[i] <= liqOpp.maxStablecoinAmountToRepay) ||
                    (liqOpp.thresholdRepayAmount != 0 &&
                        (amounts[i] == liqOpp.maxStablecoinAmountToRepay || amounts[i] <= liqOpp.thresholdRepayAmount)))
            ) {
                uint256 collateralReleased = ((amounts[i] * BASE_PARAMS) * collatBase) /
                    ((BASE_PARAMS - liqOpp.discount) * liqData.oracleValue);
                liqData.collateralAmountToGive += collateralReleased;
                liqData.stablecoinAmountToReceive += amounts[i];

                // TODO check whether with rounding it still works
                if (vault.collateralAmount <= collateralReleased) {
                    _burn(vaultIDs[i]);
                    liqData.badDebtFromLiquidation +=
                        liqOpp.currentDebt -
                        (amounts[i] * liquidationSurcharge) /
                        BASE_PARAMS;
                } else {
                    vaultData[vaultIDs[i]].collateralAmount -= collateralReleased;
                    _decreaseDebt(
                        vaultIDs[i],
                        (amounts[i] * liquidationSurcharge) / BASE_PARAMS,
                        liqData.newInterestRateAccumulator
                    );
                }
            }
        }
        // Normalization of good and bad debt is already handled
        surplus += (liqData.stablecoinAmountToReceive * (BASE_PARAMS - liquidationSurcharge)) / BASE_PARAMS;
        badDebt += liqData.badDebtFromLiquidation;
        _handleRepay(liqData.collateralAmountToGive, liqData.stablecoinAmountToReceive, from, to, who, data);
    }

    function checkLiquidation(uint256 vaultID) external view returns (LiquidationOpportunity memory liqOpp) {
        liqOpp = _checkLiquidation(vaultData[vaultID], oracle.read(), _calculateCurrentInterestRateAccumulator());
    }

    // For liquidators: should return the max amount to liquidate
    // TODO check Euler interface for this: liquidation status
    function _checkLiquidation(
        Vault memory vault,
        uint256 oracleValue,
        uint256 newInterestRateAccumulator
    ) internal view returns (LiquidationOpportunity memory liqOpp) {
        // When entering this function oracleValut and newInterestRateAccumulator should have always been
        // computed
        (bool solvent, uint256 currentDebt, uint256 collateralAmountInStable, , ) = _isSolvent(
            vault,
            oracleValue,
            newInterestRateAccumulator
        );
        if (!solvent) {
            // TODO improve: duplicate amount read, can do far far better
            uint256 healthFactor = (collateralAmountInStable * collateralFactor) / currentDebt;
            uint256 liquidationDiscount = (liquidationBooster * (BASE_PARAMS - healthFactor)) / BASE_PARAMS;
            // In fact `liquidationDiscount` is stored here as 1 minus surcharge
            liquidationDiscount = liquidationDiscount >= maxLiquidationDiscount
                ? BASE_PARAMS - maxLiquidationDiscount
                : BASE_PARAMS - liquidationDiscount;
            // Same for the surcharge here
            uint256 surcharge = liquidationSurcharge;
            // Checking if we're in a situation where the health factor is an increasing or a decreasing function of the
            // amount repaid
            uint256 maxAmountToRepay;
            uint256 thresholdAmountToRepay = 0;
            if (healthFactor * liquidationDiscount * surcharge >= collateralFactor * BASE_PARAMS**2) {
                // This is the max amount to repay that will bring the person to the target health factor
                // Denom is always greater than 1
                maxAmountToRepay =
                    (((targetHealthFactor * currentDebt) / collateralFactor - collateralAmountInStable) * BASE_PARAMS) /
                    ((surcharge * targetHealthFactor) / collateralFactor - BASE_PARAMS**2 / liquidationDiscount);
                // First with this in mind, we need to check for the dust
                if (currentDebt <= (maxAmountToRepay * surcharge) / BASE_PARAMS + dust) {
                    maxAmountToRepay = (currentDebt * BASE_PARAMS) / surcharge;
                    // In this case the threshold amount is such that it leaves just enough dust
                    thresholdAmountToRepay = ((currentDebt - dust) * BASE_PARAMS) / surcharge;
                }
            } else {
                // We're in the situation where the function is decreasing and hence:
                maxAmountToRepay = (collateralAmountInStable * liquidationDiscount) / BASE_PARAMS;
                // TODO add check threshold amount to repay
                thresholdAmountToRepay = (dustCollateral * liquidationDiscount) / BASE_PARAMS;
            }
            // TODO check improvements for what we store or not
            liqOpp.maxStablecoinAmountToRepay = maxAmountToRepay;
            liqOpp.maxCollateralAmountGiven =
                (maxAmountToRepay * BASE_PARAMS * collatBase) /
                (oracleValue * (BASE_PARAMS - liquidationDiscount));
            liqOpp.thresholdRepayAmount = thresholdAmountToRepay;
            liqOpp.discount = liquidationDiscount;
            liqOpp.currentDebt = currentDebt;
        }
    }

    // ============================== Setters ======================================

    /// @notice Sets parameters encoded as uint64
    /// @param param Value for the parameter
    /// @param what Parameter to change
    /// @dev This function performs the required checks when updating a parameter
    function setUint64(uint64 param, bytes32 what) external onlyGovernorOrGuardian {
        if (what == "collateralFactor") {
            require(param <= liquidationSurcharge, "9");
            collateralFactor = param;
        } else if (what == "targetHealthFactor") {
            require(param >= BASE_PARAMS, "17");
            targetHealthFactor = param;
        } else if (what == "borrowFee") borrowFee = param;
        else if (what == "interestRate") {
            _accrue();
            interestRate = param;
        } else if (what == "liquidationSurcharge") {
            require(collateralFactor <= param && param <= BASE_PARAMS, "18");
            liquidationSurcharge = param;
        } else if (what == "maxLiquidationDiscount") {
            require(param <= maxLiquidationDiscount, "9");
            maxLiquidationDiscount = param;
        } else if (what == "liquidationBooster") liquidationBooster = param;
        emit FiledUint64(param, what);
    }

    /// @notice Sets parameters encoded as uint256
    /// @param param Value for the parameter
    /// @param what Parameter to change
    function setUint256(uint256 param, bytes32 what) external onlyGovernorOrGuardian {
        if (what == "dust") dust = param;
        else if (what == "dustCollateral") dustCollateral = param;
        else if (what == "debtCeiling") debtCeiling = param;
        emit FiledUint256(param, what);
    }

    /// @notice Toggles permission for owning vaults by any account
    function toggleWhitelisting() external onlyGovernor {
        bool flag = !whitelistingActivated;
        whitelistingActivated = flag;
        emit ToggledWhitelisting(flag);
    }

    /// @notice Changes the reference to the oracle contract used to get the price of the oracle
    /// @param _oracle Reference to the oracle contract
    function setOracle(address _oracle) external onlyGovernor {
        // TODO check if more checks should be added
        require(_oracle != address(0), "0");
        oracle = IOracle(_oracle);
        emit OracleUpdated(_oracle);
    }

    /// @notice Sets the treasury contract
    /// @param _treasury New treasury contract
    /// @dev All required checks when setting up a treasury contract are performed in the
    function setTreasury(address _treasury) external override onlyTreasury {
        treasury = ITreasury(_treasury);
    }

    /// @notice Pauses external permissionless functions of the contract
    function pause() external onlyGovernorOrGuardian {
        _pause();
    }

    /// @notice Unpauses external permissionless functions in the contract
    function unpause() external onlyGovernorOrGuardian {
        _unpause();
    }

    // =============================== ERC721 Logic ================================

    function isApprovedOrOwner(address spender, uint256 vaultID) external view returns (bool) {
        return _isApprovedOrOwner(spender, vaultID);
    }

    /// @inheritdoc IERC721MetadataUpgradeable
    function tokenURI(uint256 vaultID) external view override returns (string memory) {
        require(_exists(vaultID), "2");
        // There is no vault with `vaultID` equal to 0, so the following variable is
        // always greater than zero
        uint256 temp = vaultID;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (vaultID != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(vaultID % 10)));
            vaultID /= 10;
        }
        return bytes(baseURI).length > 0 ? string(abi.encodePacked(baseURI, string(buffer))) : "";
    }

    /// @inheritdoc IERC721Upgradeable
    function balanceOf(address owner) external view override returns (uint256) {
        require(owner != address(0), "0");
        return _balances[owner];
    }

    /// @inheritdoc IERC721Upgradeable
    function ownerOf(uint256 vaultID) external view override returns (address) {
        return _ownerOf(vaultID);
    }

    /// @inheritdoc IERC721Upgradeable
    function approve(address to, uint256 vaultID) external override {
        address owner = _ownerOf(vaultID);
        require(to != owner, "35");
        require(msg.sender == owner || isApprovedForAll(owner, msg.sender), "21");

        _approve(to, vaultID);
    }

    /// @inheritdoc IERC721Upgradeable
    function getApproved(uint256 vaultID) external view override returns (address) {
        require(_exists(vaultID), "2");
        return _getApproved(vaultID);
    }

    /// @inheritdoc IERC721Upgradeable
    function setApprovalForAll(address operator, bool approved) external override {
        require(operator != msg.sender, "36");
        _operatorApprovals[msg.sender][operator] = approved;
        emit ApprovalForAll(_msgSender(), operator, approved);
    }

    /// @inheritdoc IERC721Upgradeable
    function isApprovedForAll(address owner, address operator) public view override returns (bool) {
        return _operatorApprovals[owner][operator];
    }

    /// @inheritdoc IERC721Upgradeable
    function transferFrom(
        address from,
        address to,
        uint256 vaultID
    ) external override onlyApprovedOrOwner(msg.sender, vaultID) {
        _transfer(from, to, vaultID);
    }

    /// @inheritdoc IERC721Upgradeable
    function safeTransferFrom(
        address from,
        address to,
        uint256 vaultID
    ) external override {
        safeTransferFrom(from, to, vaultID, "");
    }

    /// @inheritdoc IERC721Upgradeable
    function safeTransferFrom(
        address from,
        address to,
        uint256 vaultID,
        bytes memory _data
    ) public override onlyApprovedOrOwner(msg.sender, vaultID) {
        _safeTransfer(from, to, vaultID, _data);
    }

    // =============================== ERC165 logic ================================

    /// @inheritdoc IERC165Upgradeable
    function supportsInterface(bytes4 interfaceId) external pure override(IERC165Upgradeable) returns (bool) {
        return
            interfaceId == type(IERC721MetadataUpgradeable).interfaceId ||
            interfaceId == type(IERC721Upgradeable).interfaceId ||
            interfaceId == type(IERC165Upgradeable).interfaceId;
    }

    function _ownerOf(uint256 vaultID) internal view returns (address owner) {
        owner = _owners[vaultID];
        require(owner != address(0), "2");
    }

    function _getApproved(uint256 vaultID) internal view returns (address) {
        return _vaultApprovals[vaultID];
    }

    function _safeTransfer(
        address from,
        address to,
        uint256 vaultID,
        bytes memory _data
    ) internal {
        _transfer(from, to, vaultID);
        require(_checkOnERC721Received(from, to, vaultID, _data), "24");
    }

    function _exists(uint256 vaultID) internal view returns (bool) {
        return _owners[vaultID] != address(0);
    }

    function _isApprovedOrOwner(address spender, uint256 vaultID) internal view returns (bool) {
        // The following checks if the vault exists
        address owner = _ownerOf(vaultID);
        return (spender == owner || _getApproved(vaultID) == spender || _operatorApprovals[owner][spender]);
    }

    function _mint(address to, uint256 vaultID) internal {
        _balances[to] += 1;
        _owners[vaultID] = to;
        emit Transfer(address(0), to, vaultID);
        require(_checkOnERC721Received(address(0), to, vaultID, ""), "24");
    }

    function _burn(uint256 vaultID) internal {
        address owner = _ownerOf(vaultID);

        // Clear approvals
        _approve(address(0), vaultID);

        _balances[owner] -= 1;
        delete _owners[vaultID];
        delete vaultData[vaultID];

        emit Transfer(owner, address(0), vaultID);
    }

    function _transfer(
        address from,
        address to,
        uint256 vaultID
    ) internal {
        require(_ownerOf(vaultID) == from, "1");
        require(to != address(0), "26");
        require(!whitelistingActivated || isWhitelisted[to], "not whitelisted");
        // Clear approvals from the previous owner
        _approve(address(0), vaultID);

        _balances[from] -= 1;
        _balances[to] += 1;
        _owners[vaultID] = to;

        emit Transfer(from, to, vaultID);
    }

    function _approve(address to, uint256 vaultID) internal {
        _vaultApprovals[vaultID] = to;
        emit Approval(_ownerOf(vaultID), to, vaultID);
    }

    function _checkOnERC721Received(
        address from,
        address to,
        uint256 vaultID,
        bytes memory _data
    ) private returns (bool) {
        if (to.isContract()) {
            try IERC721ReceiverUpgradeable(to).onERC721Received(msg.sender, from, vaultID, _data) returns (
                bytes4 retval
            ) {
                return retval == IERC721ReceiverUpgradeable(to).onERC721Received.selector;
            } catch (bytes memory reason) {
                if (reason.length == 0) {
                    revert("24");
                } else {
                    // solhint-disable-next-line no-inline-assembly
                    assembly {
                        revert(add(32, reason), mload(reason))
                    }
                }
            }
        } else {
            return true;
        }
    }
}
