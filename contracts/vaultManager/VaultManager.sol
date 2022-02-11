// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.10;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/IERC721ReceiverUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/IERC721Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/introspection/ERC165Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/AddressUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/CountersUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../interfaces/IAgToken.sol";
import "../interfaces/IERC721.sol";
import "../interfaces/IFlashLoanCallee.sol";
import "../interfaces/IOracle.sol";
import "../interfaces/ITreasury.sol";
import "../interfaces/IVaultManager.sol";

struct VaultParameters {
    uint256 dust;
    uint256 debtCeiling;
    uint64 collateralFactor;
    uint64 targetHealthFactor;
    uint64 dustCollateral;
    uint64 borrowFee;
    uint64 interestRate;
    uint64 liquidationSurcharge;
    uint64 maxLiquidationDiscount;
    uint64 liquidationBooster;
}

struct Vault {
    uint256 collateralAmount;
    uint256 normalizedDebt;
}

struct LiquidationOpportunity {
    // Only populated if repay > 0
    uint256 maxStablecoinAmountToRepay;
    // Collateral Amount given to the person in case of max amount
    uint256 maxCollateralAmountGiven;
    // Ok to repay below threshold, but if above, should repay max stablecoin amount
    uint256 thresholdRepayAmount;
    // Discount proposed
    uint256 discount;
    uint256 currentDebt;
}

struct LiquidatorData {
    uint256 stablecoinAmountToRepay;
    uint256 collateralAmountToGive;
    uint256 badDebtFromLiquidation;
    uint256 oracleValue;
    uint256 newInterestRateAccumulator;
}

struct PaymentData {
    uint256 stablecoinAmountToGive;
    uint256 stablecoinAmountToReceive;
    uint256 collateralAmountToGive;
    uint256 collateralAmountToReceive;
}

// TODO split in multiple files and leave some space each time for upgradeability -> check how we can leverage libraries this time
// TODO reentrancy calls here -> should we put more and where to make sure we are not vulnerable to hacks here
// TODO check trade-off 10**27 and 10**18 for interest accumulated
// TODO check liquidationBooster depending on veANGLE with like a veANGLE delegation feature
// TODO add returns to functions

/// @title VaultManager
/// @author Angle Core Team
/// @notice VaultManager implementation of Angle Borrowing Module working only with non-rebasing ERC-20
// solhint-disable-next-line max-states-count
contract VaultManager is
    Initializable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable,
    IERC721Metadata,
    IVaultManager
{
    using SafeERC20 for IERC20;
    using CountersUpgradeable for CountersUpgradeable.Counter;
    using Address for address;

    /// @notice Base used for parameter computation
    uint256 public constant BASE_PARAMS = 10**9;
    /// @notice Base used for interest rate computation
    uint256 public constant BASE_INTEREST = 10**27;

    event FiledUint64(uint64 param, bytes32 what);
    event FiledUint256(uint256 param, bytes32 what);
    event FiledAddress(address param, bytes32 what);
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

    /// Mappings
    mapping(address => bool) public isWhitelisted;

    /// References to other contracts
    ITreasury public override treasury;
    IERC20 public collateral;
    IAgToken public stablecoin;
    IOracle public oracle;
    uint256 public collatBase;

    /// Parameters
    uint256 public dust;
    uint256 public debtCeiling;
    uint64 public collateralFactor;
    uint64 public targetHealthFactor;
    uint64 public dustCollateral;
    uint64 public borrowFee;
    // should be per second
    uint64 public interestRate;
    uint64 public liquidationSurcharge;
    uint64 public maxLiquidationDiscount;
    uint64 public liquidationBooster;
    bool public whitelistingActivated;

    /// Variables
    uint256 public lastInterestAccumulatorUpdated;
    uint256 public interestAccumulator;
    uint256 public totalNormalizedDebt;
    uint256 public surplus;
    uint256 public badDebt;
    // Counter to generate a unique `vaultID` for each vault
    CountersUpgradeable.Counter internal _vaultIDcount;

    // ============================== ERC721 Data ==============================

    string public baseURI;
    string public override name;
    string public override symbol;

    mapping(uint256 => Vault) public vaultData;

    // Mapping from `vaultID` to owner address
    mapping(uint256 => address) internal _owners;

    // Mapping from owner address to vault owned count
    mapping(address => uint256) internal _balances;

    // Mapping from `vaultID` to approved address
    mapping(uint256 => address) internal _vaultApprovals;

    // Mapping from owner to operator approvals
    mapping(address => mapping(address => bool)) internal _operatorApprovals;

    function initialize(
        ITreasury _treasury,
        address _collateral,
        IOracle _oracle,
        string memory symbolVault,
        VaultParameters calldata params
    ) public initializer {
        require(address(oracle) != address(0), "0");
        treasury = _treasury;
        collateral = IERC20(_collateral);
        collatBase = 10**(IERC20Metadata(address(collateral)).decimals());
        stablecoin = IAgToken(_treasury.stablecoin());
        oracle = _oracle;

        name = string(abi.encodePacked("Angle Protocol ", symbolVault, " Vault"));
        symbol = string(abi.encodePacked(symbolVault, "-vault"));

        // Check what is used here
        interestAccumulator = BASE_INTEREST;
        // TODO verify conditions for all of them
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
        _pause();
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() initializer {}

    modifier onlyGovernorOrGuardian() {
        require(treasury.isGovernorOrGuardian(msg.sender));
        _;
    }

    modifier onlyGovernor() {
        require(treasury.isGovernor(msg.sender));
        _;
    }

    modifier onlyTreasury() {
        require(msg.sender == address(treasury));
        _;
    }

    modifier onlyApprovedOrOwner(address caller, uint256 vaultID) {
        require(_isApprovedOrOwner(caller, vaultID), "21");
        _;
    }

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
        // TODO optimize values which are fetched to avoid duplicate reads in storage
        // Could be done by storing a memory struct or something like that
        if (oracleValue == 0) oracleValue = oracle.read();
        if (newInterestRateAccumulator == 0) newInterestRateAccumulator = _calculateCurrentInterestRateAccumulator();
        uint256 currentDebt = vault.normalizedDebt * newInterestRateAccumulator;
        uint256 collateralAmountInStable = (vault.collateralAmount * oracleValue) / collatBase;
        bool solvent = collateralAmountInStable * collateralFactor >= currentDebt * BASE_PARAMS;
        return (solvent, currentDebt, collateralAmountInStable, oracleValue, newInterestRateAccumulator);
    }

    function setUint64(uint64 param, bytes32 what) external onlyGovernorOrGuardian {
        if (what == "collateralFactor")
            collateralFactor = param; // TODO such that conditions are verified
        else if (what == "targetHealthFactor")
            targetHealthFactor = param; // TODO check if strictly superior to 1
        else if (what == "dustCollateral")
            dustCollateral = param; // TODO check if it is inferior to 1
        else if (what == "borrowFee") borrowFee = param;
        else if (what == "interestRate") {
            _accrue();
            interestRate = param; // TODO specific function for this to update the rate
        } else if (what == "liquidationSurcharge")
            // Here if fee is like 2% then surcharge should be BASE_PARAMS - 2%
            liquidationSurcharge = param; // TODO such that condition remains verified here
        else if (what == "maxLiquidationDiscount")
            maxLiquidationDiscount = param; // TODO inferior to 100% -> BASE_PARAMS
            // TODO such that denominator in liquidation is verified
        else if (what == "liquidationBooster") liquidationBooster = param;
        emit FiledUint64(param, what);
    }

    function setUint256(uint256 param, bytes32 what) external onlyGovernorOrGuardian {
        if (what == "dust") dust = param;
        else if (what == "debtCeiling") debtCeiling = param;
        emit FiledUint256(param, what);
    }

    function toggleBool(bool param, bytes32 what) external onlyGovernor {
        if (what == "whitelisting") whitelistingActivated = param;
    }

    function setAddress(address param, bytes32 what) external onlyGovernor {
        if (what == "oracle") oracle = IOracle(param);
        else if (what == "treasury") treasury = ITreasury(param); // TODO check that vaultManager is valid in it and that governor
        // calling the function is also a new governor in the new one also perform zero check
    }

    function pause() external onlyGovernorOrGuardian {
        _pause();
    }

    function unpause() external onlyGovernorOrGuardian {
        _unpause();
    }

    function getVaultDebt(uint256 vaultID) external view returns (uint256) {
        // TODO check with accrued interest of a vault
        return vaultData[vaultID].normalizedDebt * _calculateCurrentInterestRateAccumulator();
    }

    function getTotalDebt() external view returns (uint256) {
        return totalNormalizedDebt * _calculateCurrentInterestRateAccumulator();
    }

    // TODO could increase efficiency by reducing the size of this function's signature?
    function _calculateCurrentInterestRateAccumulator() internal view returns (uint256) {
        // TODO test Aave's solution wrt to Maker solution in terms of gas and how much it costs here
        uint256 exp = block.timestamp - lastInterestAccumulatorUpdated;
        if (exp == 0) return interestAccumulator;
        uint256 expMinusOne = exp - 1;
        uint256 expMinusTwo = exp > 2 ? exp - 2 : 0;
        // TODO check rayMul here: https://github.com/aave/protocol-v2/blob/61c2273a992f655c6d3e7d716a0c2f1b97a55a92/contracts/protocol/libraries/math/WadRayMath.sol
        uint256 ratePerSecond = interestRate;
        // TODO check this
        uint256 basePowerTwo = ratePerSecond * ratePerSecond;
        uint256 basePowerThree = basePowerTwo * ratePerSecond;

        uint256 secondTerm = (exp * expMinusOne * basePowerTwo) / 2;
        uint256 thirdTerm = (exp * expMinusOne * expMinusTwo * basePowerThree) / 6;

        return interestAccumulator * (BASE_INTEREST + ratePerSecond * exp + secondTerm + thirdTerm);
    }

    function createVault(address toVault) external whenNotPaused returns (uint256) {
        return _createVault(toVault);
    }

    function _createVault(address toVault) internal returns (uint256 vaultID) {
        require(!whitelistingActivated || (isWhitelisted[toVault] && isWhitelisted[msg.sender]), "not whitelisted");
        _vaultIDcount.increment();
        vaultID = _vaultIDcount.current();
        _mint(toVault, vaultID);
    }

    // TODO check allowance of from with respect to msg.sender somewhere
    function closeVault(
        uint256 vaultID,
        address from,
        address to,
        address who,
        bytes calldata data
    ) external whenNotPaused onlyApprovedOrOwner(msg.sender, vaultID) nonReentrant {
        // TODO check exact data types for what to do with the swap
        // TODO check what happens in other protocols if you come to close but you're about to get liquidated
        // TODO once again here need to check the allowance in the repay with from
        // Get vault debt
        (uint256 currentDebt, uint256 collateralAmount, , ) = _closeVault(vaultID, 0, 0);
        _handleRepay(collateralAmount, currentDebt, from, to, who, data);
    }

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

    function addCollateral(uint256 vaultID, uint256 collateralAmount) external whenNotPaused {
        collateral.safeTransferFrom(msg.sender, address(this), collateralAmount);
        _addCollateral(vaultID, collateralAmount);
    }

    function _addCollateral(uint256 vaultID, uint256 collateralAmount) internal {
        vaultData[vaultID].collateralAmount += collateralAmount;
    }

    function removeCollateral(
        uint256 vaultID,
        uint256 collateralAmount,
        address to
    ) external whenNotPaused {
        _removeCollateral(vaultID, collateralAmount, 0, 0);
        collateral.transfer(to, collateralAmount);
    }

    // Optimize the `isLiquidable` thing
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

    function repayDebt(
        uint256 vaultID,
        uint256 stablecoinAmount,
        address from
    ) external whenNotPaused {
        stablecoin.burnFrom(stablecoinAmount, from, msg.sender);
        _decreaseDebt(vaultID, stablecoinAmount, 0);
    }

    function borrow(
        uint256 vaultID,
        uint256 stablecoinAmount,
        address to
    ) external whenNotPaused {
        (uint256 toMint, , ) = _borrow(vaultID, stablecoinAmount, 0, 0);
        stablecoin.mint(to, toMint);
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

    function getDebtIn(
        IVaultManager vaultManager,
        uint256 srcVaultID,
        uint256 dstVaultID,
        uint256 stablecoinAmount
    ) external whenNotPaused {
        _getDebtIn(vaultManager, srcVaultID, dstVaultID, stablecoinAmount, 0, 0);
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
        require(treasury.isVaultManager(address(vaultManager)));
        vaultManager.getDebtOut(dstVaultID, stablecoinAmount, borrowFee);
        return _increaseDebt(srcVaultID, stablecoinAmount, oracleValue, newInterestRateAccumulator);
    }

    // Should be public to allow `getDebtOut`
    function getDebtOut(
        uint256 vaultID,
        uint256 stablecoinAmount,
        uint256 senderBorrowFee
    ) public override whenNotPaused {
        require(treasury.isVaultManager(msg.sender));
        // Check the delta of borrow fees to reduce the surface of exploits here
        if (senderBorrowFee > borrowFee) {
            uint256 borrowFeePaid = ((senderBorrowFee - borrowFee) * stablecoinAmount) / BASE_PARAMS;
            stablecoinAmount -= borrowFeePaid;
            surplus += borrowFeePaid;
        }
        _decreaseDebt(vaultID, stablecoinAmount, 0);
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

    function setTreasury(address _newTreasury) external override onlyTreasury {
        treasury = ITreasury(_newTreasury);
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
                liqData.stablecoinAmountToRepay += amounts[i];

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
        surplus += (liqData.stablecoinAmountToRepay * (BASE_PARAMS - liquidationSurcharge)) / BASE_PARAMS;
        badDebt += liqData.badDebtFromLiquidation;
        _handleRepay(liqData.collateralAmountToGive, liqData.stablecoinAmountToRepay, from, to, who, data);
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

    // =============================== ERC721 Logic ================================

    /// @notice Gets the URI containing metadata
    /// @param vaultID ID of the vault
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

    /// @notice Gets the balance of an owner
    /// @param owner Address of the owner
    /// @dev Balance here represents the number of vaults owned by a HA
    function balanceOf(address owner) external view override returns (uint256) {
        require(owner != address(0), "0");
        return _balances[owner];
    }

    /// @notice Gets the owner of the vault with ID vaultID
    /// @param vaultID ID of the vault
    function ownerOf(uint256 vaultID) external view override returns (address) {
        return _ownerOf(vaultID);
    }

    /// @notice Approves to an address specified by `to` a vault specified by `vaultID`
    /// @param to Address to approve the vault to
    /// @param vaultID ID of the vault
    /// @dev The approved address will have the right to transfer the vault, to cash it out
    /// on behalf of the owner, to add or remove collateral in it and to choose the destination
    /// address that will be able to receive the proceeds of the vault
    function approve(address to, uint256 vaultID) external override {
        address owner = _ownerOf(vaultID);
        require(to != owner, "35");
        require(msg.sender == owner || isApprovedForAll(owner, msg.sender), "21");

        _approve(to, vaultID);
    }

    /// @notice Gets the approved address by a vault owner
    /// @param vaultID ID of the concerned vault
    function getApproved(uint256 vaultID) external view override returns (address) {
        require(_exists(vaultID), "2");
        return _getApproved(vaultID);
    }

    /// @notice Sets approval on all vaults owned by the owner to an operator
    /// @param operator Address to approve (or block) on all vaults
    /// @param approved Whether the sender wants to approve or block the operator
    function setApprovalForAll(address operator, bool approved) external override {
        require(operator != msg.sender, "36");
        _operatorApprovals[msg.sender][operator] = approved;
        emit ApprovalForAll(_msgSender(), operator, approved);
    }

    /// @notice Gets if the operator address is approved on all vaults by the owner
    /// @param owner Owner of vaults
    /// @param operator Address to check if approved
    function isApprovedForAll(address owner, address operator) public view override returns (bool) {
        return _operatorApprovals[owner][operator];
    }

    /// @notice Gets if the sender address is approved for the vaultId
    /// @param vaultID ID of the vault
    function isApprovedOrOwner(address spender, uint256 vaultID) external view returns (bool) {
        return _isApprovedOrOwner(spender, vaultID);
    }

    /// @notice Transfers the `vaultID` from an address to another
    /// @param from Source address
    /// @param to Destination a address
    /// @param vaultID ID of the vault to transfer
    function transferFrom(
        address from,
        address to,
        uint256 vaultID
    ) external override onlyApprovedOrOwner(msg.sender, vaultID) {
        _transfer(from, to, vaultID);
    }

    /// @notice Safely transfers the `vaultID` from an address to another without data in it
    /// @param from Source address
    /// @param to Destination a address
    /// @param vaultID ID of the vault to transfer
    function safeTransferFrom(
        address from,
        address to,
        uint256 vaultID
    ) external override {
        safeTransferFrom(from, to, vaultID, "");
    }

    /// @notice Safely transfers the `vaultID` from an address to another with data in the transfer
    /// @param from Source address
    /// @param to Destination a address
    /// @param vaultID ID of the vault to transfer
    function safeTransferFrom(
        address from,
        address to,
        uint256 vaultID,
        bytes memory _data
    ) public override onlyApprovedOrOwner(msg.sender, vaultID) {
        _safeTransfer(from, to, vaultID, _data);
    }

    // =============================== ERC165 logic ================================

    /// @notice Queries if a contract implements an interface
    /// @param interfaceId The interface identifier, as specified in ERC-165
    /// @dev Interface identification is specified in ERC-165. This function uses less than 30,000 gas.
    /// Required by the ERC721 standard, so used to check that the IERC721 is implemented.
    /// @return `true` if the contract implements `interfaceID` and
    ///  `interfaceID` is not 0xffffffff, `false` otherwise
    function supportsInterface(bytes4 interfaceId) external pure override(IERC165) returns (bool) {
        return
            interfaceId == type(IERC721Metadata).interfaceId ||
            interfaceId == type(IERC721).interfaceId ||
            interfaceId == type(IERC165).interfaceId;
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
