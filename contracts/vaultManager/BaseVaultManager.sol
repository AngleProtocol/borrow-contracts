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
    uint64 dustHealthFactor;
    uint64 borrowFee;
    uint64 interestRate;
    uint64 liquidationFee;
    uint64 maxLiquidationDiscount;
    uint64 liquidationBooster;
}

struct Vault {
    uint256 collateralInternalValue;
    uint256 normalizedDebt;
}

struct LiquidationOpportunity {
    // Only populated if repay > 0
    uint256 maxStablecoinAmountToRepay;
    // Collateral Amount given to the person in case of max amount
    uint256 maxCollateralAmountGiven;
    // Ok to repay below threshold, but if above, should repay max stablecoin amount
    uint256 thresholdRepayAmount;
    // Health Score of the vault
    uint256 healthScore;
    // Discount proposed
    uint256 discount;
    // TODO do we do something like the conversionRate Euler is doing for liquidation opportunities
    uint256 collateralAmount;
    uint256 currentDebt;
}

struct LiquidatorData {
    uint256 stablecoinAmountToRepay;
    uint256 collateralAmountToGive;
    uint256 badDebtFromLiquidation;
    uint256 oracleValue;
    uint256 newInterestRateAccumulator;
}

// TODO split in multiple files and leave some space each time for upgradeability -> check how we can leverage libraries this time
// TODO reentrancy calls here -> should we put more and where to make sure we are not vulnerable to hacks here

// solhint-disable-next-line max-states-count
abstract contract BaseVaultManager is
    Initializable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable,
    IERC721Metadata,
    IVaultManager
{
    using SafeERC20 for IERC20;
    using CountersUpgradeable for CountersUpgradeable.Counter;
    using Address for address;

    uint256 public constant BASE_PARAMS = 10**9;
    // TODO check trade-off 10**27 and 10**18 for interest accumulated
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
    ITreasury public treasury;
    IERC20 public collateral;
    IAgToken public stablecoin;
    IOracle public oracle;
    uint256 public collatBase;

    /// Parameters
    uint256 public dust;
    uint256 public debtCeiling;
    uint64 public collateralFactor;
    uint64 public targetHealthFactor;
    uint64 public dustHealthFactor;
    uint64 public borrowFee;
    // should be per second
    uint64 public interestRate;
    uint64 public liquidationFee;
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
        require(_treasury.isVaultManager(address(this)));
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
        dustHealthFactor = params.dustHealthFactor;
        borrowFee = params.borrowFee;
        interestRate = params.interestRate;
        liquidationFee = params.liquidationFee;
        maxLiquidationDiscount = params.maxLiquidationDiscount;
        liquidationBooster = params.liquidationBooster;
        _pause();
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    // TODO check if still needed with new version of OpenZeppelin initializable contract
    constructor() initializer {}

    modifier onlyGovernorOrGuardian() {
        require(treasury.isGovernorOrGuardian(msg.sender));
        _;
    }

    modifier onlyGovernor() {
        require(treasury.isGovernor(msg.sender));
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
            bool solvent,
            uint256 currentDebt,
            uint256 collateralAmount,
            uint256 collateralAmountInStable
        )
    {
        // TODO optimize values which are fetched to avoid duplicate reads in storage
        // Could be done by storing a memory struct or something like that
        if (oracleValue == 0) oracleValue = oracle.read();
        if (newInterestRateAccumulator == 0) newInterestRateAccumulator = _calculateCurrentInterestRateAccumulator();
        currentDebt = vault.normalizedDebt * newInterestRateAccumulator;
        collateralAmount = _getCollateralAmount(vault.collateralInternalValue);
        collateralAmountInStable = (collateralAmount * oracleValue) / collatBase;
        solvent = collateralAmountInStable * collateralFactor >= currentDebt * BASE_PARAMS;
    }

    // For the case with stETH and ETH: there can be differences here
    // Converts a real amount of collateral to something which does not have the value
    function _getCollateralInternalValue(uint256 collateralAmount) internal view virtual returns (uint256);

    function _getCollateralAmount(uint256 collateralInternalValue) internal view virtual returns (uint256);

    function setUint64(uint64 param, bytes32 what) external onlyGovernorOrGuardian {
        if (what == "collateralFactor")
            collateralFactor = param; // TODO such that conditions are verified
        else if (what == "targetHealthFactor")
            targetHealthFactor = param; // TODO check if strictly superior to 1
        else if (what == "dustHealthFactor")
            dustHealthFactor = param; // TODO check if it is inferior to 1
        else if (what == "borrowFee") borrowFee = param;
        else if (what == "interestRate") {
            _accrue();
            interestRate = param; // TODO specific function for this to update the rate
        } else if (what == "liquidationFee")
            liquidationFee = param; // TODO such that condition remains verified here
        else if (what == "maxLiquidationDiscount")
            maxLiquidationDiscount = param; // TODO inferior to 100% -> BASE_PARAMS
            // TODO such that denominator in liquidation is verified
        else if (what == "liquidationBooster") liquidationBooster = param;
        emit FiledUint64(param, what);
    }

    function pause() external onlyGovernorOrGuardian {
        _pause();
    }

    function unpause() external onlyGovernorOrGuardian {
        _unpause();
    }

    function setUint256(uint256 param, bytes32 what) external onlyGovernorOrGuardian {
        if (what == "dust") dust = param;
        else if (what == "debtCeiling") debtCeiling = param;
        emit FiledUint256(param, what);
    }

    function toggleBool(uint256 param, bytes32 what) external onlyGovernor {
        if (what == "whitelisting") dust = param;
    }

    function setAddress(address param, bytes32 what) external onlyGovernor {
        if (what == "oracle") oracle = IOracle(param);
        else if (what == "treasury") treasury = ITreasury(param); // TODO check that vaultManager is valid in it and that governor
        // calling the function is also a new governor in the new one also perform zero check
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

    function createVault(
        uint256 collateralAmount,
        uint256 stablecoinAmount,
        address toVault,
        address toStablecoin
    ) external whenNotPaused returns (uint256 vaultID) {
        require(!whitelistingActivated || isWhitelisted[msg.sender], "not whitelisted");
        require(stablecoinAmount >= dust);
        collateral.safeTransferFrom(msg.sender, address(this), collateralAmount);
        uint256 newInterestRateAccumulator = _calculateCurrentInterestRateAccumulator();

        uint256 vaultNormalizedDebt = (stablecoinAmount * BASE_INTEREST) / newInterestRateAccumulator;
        totalNormalizedDebt += vaultNormalizedDebt;
        // Checking debt ceiling
        require(totalNormalizedDebt * newInterestRateAccumulator <= debtCeiling * BASE_INTEREST);

        uint256 borrowFeePaid = (borrowFee * stablecoinAmount) / BASE_PARAMS;
        surplus += borrowFeePaid;

        _vaultIDcount.increment();
        vaultID = _vaultIDcount.current();
        vaultData[vaultID] = Vault(_getCollateralInternalValue(collateralAmount), vaultNormalizedDebt);
        _mint(toVault, vaultID);

        stablecoin.mint(toStablecoin, stablecoinAmount - borrowFeePaid);
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
        Vault memory vault = vaultData[vaultID];
        // Optimize for gas here
        (bool solvent, uint256 currentDebt, uint256 collateralAmount, ) = _isSolvent(vault, 0, 0);
        require(solvent);
        _burn(vaultID);
        _handleRepay(collateralAmount, currentDebt, from, to, who, data);
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
            IFlashLoanCallee(who).flashLoanCall(from, stableAmountToRepay, collateralAmountToGive, data);
        }
        stablecoin.burnFrom(stableAmountToRepay, from, msg.sender);
    }

    function addCollateral(
        uint256 vaultID,
        uint256 collateralAmount,
        address from
    ) external whenNotPaused {
        _addCollateral(vaultID, collateralAmount, from);
    }

    function _addCollateral(
        uint256 vaultID,
        uint256 collateralAmount,
        address from
    ) internal {
        collateral.safeTransferFrom(from, address(this), collateralAmount);
        vaultData[vaultID].collateralInternalValue += _getCollateralInternalValue(collateralAmount);
    }

    function removeCollateral(
        uint256 vaultID,
        uint256 collateralAmount,
        address to
    ) external whenNotPaused {
        _removeCollateral(vaultID, collateralAmount, to, 0, 0);
    }

    // Optimize the `isLiquidable` thing
    function _removeCollateral(
        uint256 vaultID,
        uint256 collateralAmount,
        address to,
        uint256 oracleValue,
        uint256 newInterestRateAccumulator
    ) internal onlyApprovedOrOwner(msg.sender, vaultID) {
        vaultData[vaultID].collateralInternalValue -= _getCollateralInternalValue(collateralAmount);
        (bool solvent, , , ) = _isSolvent(vaultData[vaultID], oracleValue, newInterestRateAccumulator);
        require(solvent);
        collateral.transfer(to, collateralAmount);
    }

    function repayDebt(
        uint256 vaultID,
        uint256 stablecoinAmount,
        address from
    ) external whenNotPaused {
        _repayDebt(vaultID, stablecoinAmount, from, 0);
    }

    function _repayDebt(
        uint256 vaultID,
        uint256 stablecoinAmount,
        address from,
        uint256 newInterestRateAccumulator
    ) internal {
        // TODO Change agEUR contract
        stablecoin.burnFrom(stablecoinAmount, from, msg.sender);
        _decreaseDebt(vaultID, stablecoinAmount, newInterestRateAccumulator);
    }

    function borrow(
        uint256 vaultID,
        uint256 stablecoinAmount,
        address to
    ) external whenNotPaused {
        _borrow(vaultID, stablecoinAmount, to, 0, 0);
    }

    // TODO check order with which we have to place the modifiers for it to work
    function _borrow(
        uint256 vaultID,
        uint256 stablecoinAmount,
        address to,
        uint256 oracleValue,
        uint256 newInterestRateAccumulator
    ) internal onlyApprovedOrOwner(msg.sender, vaultID) {
        _increaseDebt(vaultID, stablecoinAmount, oracleValue, newInterestRateAccumulator);
        uint256 borrowFeePaid = (borrowFee * stablecoinAmount) / BASE_PARAMS;
        stablecoin.mint(to, stablecoinAmount - borrowFeePaid);
    }

    function _increaseDebt(
        uint256 vaultID,
        uint256 stablecoinAmount,
        uint256 oracleValue,
        uint256 newInterestRateAccumulator
    ) internal returns (uint256) {
        if (newInterestRateAccumulator == 0) newInterestRateAccumulator = _calculateCurrentInterestRateAccumulator();
        uint256 changeAmount = (stablecoinAmount * BASE_INTEREST) / newInterestRateAccumulator;
        vaultData[vaultID].normalizedDebt += changeAmount;
        totalNormalizedDebt += changeAmount;
        require(totalNormalizedDebt * newInterestRateAccumulator <= debtCeiling * BASE_INTEREST);
        (bool solvent, , , ) = _isSolvent(vaultData[vaultID], oracleValue, newInterestRateAccumulator);
        require(solvent);
        return newInterestRateAccumulator;
    }

    function _decreaseDebt(
        uint256 vaultID,
        uint256 stablecoinAmount,
        uint256 newInterestRateAccumulator
    ) internal {
        uint256 changeAmount = (stablecoinAmount * BASE_INTEREST) / newInterestRateAccumulator;
        uint256 newVaultNormalizedDebt = vaultData[vaultID].normalizedDebt - changeAmount;
        totalNormalizedDebt -= changeAmount;
        // TODO check if can be done more efficiently
        require(
            newVaultNormalizedDebt == 0 || newVaultNormalizedDebt * newInterestRateAccumulator >= dust * BASE_INTEREST
        );
        vaultData[vaultID].normalizedDebt = newVaultNormalizedDebt;
    }

    function getDebtIn(
        IVaultManager vaultManager,
        uint256 srcVaultID,
        uint256 dstVaultID,
        uint256 stablecoinAmount
    ) external whenNotPaused onlyApprovedOrOwner(msg.sender, srcVaultID) {
        // Checking if the vaultManager has been initialized
        // TODO
        require(treasury.isVaultManager(address(vaultManager)));
        vaultManager.getDebtOut(dstVaultID, stablecoinAmount);
        _increaseDebt(srcVaultID, stablecoinAmount, 0, 0);
    }

    // Should be public to allow `getDebtOut`
    function getDebtOut(uint256 vaultID, uint256 stablecoinAmount) public override whenNotPaused {
        // TODO require that collateral comes from the right source
        require(treasury.isVaultManager(msg.sender));
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
        returns (uint256 surplusCurrentValue, uint256 badDebtEndValue)
    {
        require(msg.sender == address(treasury));
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
        badDebt = badDebtEndValue;
    }

    uint8 public constant ACTION_ADD_COLLATERAL = 1;
    uint8 public constant ACTION_REMOVE_COLLATERAL = 2;
    uint8 public constant ACTION_REPAY_DEBT = 3;
    uint8 public constant ACTION_BORROW = 4;

    /*
    // TODO: do we add the following actions? for more composability
    uint8 public constant ACTION_OPEN_VAULT = 5;
    uint8 public constant ACTION_CLOSE_VAULT = 6;
    uint8 public constant ACTION_ACCRUE = 7;
    uint8 public constant ACTION_GET_DEBT_IN = 8;
    */

    // For composability of calls
    function angle(uint8[] calldata actions, bytes[] calldata datas) external payable whenNotPaused nonReentrant {
        uint256 newInterestRateAccumulator;
        uint256 oracleValue;
        for (uint256 i = 0; i < actions.length; i++) {
            uint8 action = actions[i];
            // TODO can we improve the ifs for oracleValue and interestRateAccumulator to make sure fewer checks are made
            (uint256 vaultID, uint256 amount, address concerned) = abi.decode(datas[i], (uint256, uint256, address));
            if (action == ACTION_ADD_COLLATERAL) {
                _addCollateral(vaultID, amount, concerned);
            } else if (action == ACTION_REMOVE_COLLATERAL) {
                if (oracleValue == 0) oracleValue = oracle.read();
                if (newInterestRateAccumulator == 0)
                    newInterestRateAccumulator = _calculateCurrentInterestRateAccumulator();
                _removeCollateral(vaultID, amount, concerned, oracleValue, newInterestRateAccumulator);
            } else if (action == ACTION_REPAY_DEBT) {
                if (newInterestRateAccumulator == 0)
                    newInterestRateAccumulator = _calculateCurrentInterestRateAccumulator();
                _repayDebt(vaultID, amount, concerned, newInterestRateAccumulator);
            } else if (action == ACTION_BORROW) {
                if (oracleValue == 0) oracleValue = oracle.read();
                if (newInterestRateAccumulator == 0)
                    newInterestRateAccumulator = _calculateCurrentInterestRateAccumulator();
                _borrow(vaultID, amount, concerned, oracleValue, newInterestRateAccumulator);
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
                ((liqOpp.thresholdRepayAmount == 0 && amounts[i] < liqOpp.maxStablecoinAmountToRepay) ||
                    (liqOpp.thresholdRepayAmount != 0 &&
                        (amounts[i] == liqOpp.maxStablecoinAmountToRepay || amounts[i] <= liqOpp.thresholdRepayAmount)))
            ) {
                uint256 collateralReleased = ((amounts[i] * BASE_PARAMS) * collatBase) /
                    ((BASE_PARAMS - liqOpp.discount) * liqData.oracleValue);
                liqData.collateralAmountToGive += collateralReleased;
                liqData.stablecoinAmountToRepay += amounts[i];

                // TODO duplicate checks here it has already been called -> Optimize for it
                // Checking if we end in a situation where too much collateral is being released
                if (liqOpp.collateralAmount <= collateralReleased) {
                    _burn(vaultIDs[i]);
                    liqData.badDebtFromLiquidation +=
                        liqOpp.currentDebt -
                        (amounts[i] * (BASE_PARAMS - liquidationFee)) /
                        BASE_PARAMS;
                } else {
                    vaultData[vaultIDs[i]].collateralInternalValue -= _getCollateralInternalValue(collateralReleased);
                    _decreaseDebt(
                        vaultIDs[i],
                        (amounts[i] * (BASE_PARAMS - liquidationFee)) / BASE_PARAMS,
                        liqData.newInterestRateAccumulator
                    );
                }
            }
        }
        // Normalization of good and bad debt is already handled
        surplus += (liqData.stablecoinAmountToRepay * liquidationFee) / BASE_PARAMS;
        badDebt += liqData.badDebtFromLiquidation;
        _handleRepay(liqData.collateralAmountToGive, liqData.stablecoinAmountToRepay, from, to, who, data);
    }

    function checkLiquidation(uint256 vaultID) external view returns (LiquidationOpportunity memory liqOpp) {
        Vault memory vault = vaultData[vaultID];
        uint256 oracleValue = oracle.read();
        uint256 newInterestRateAccumulator = _calculateCurrentInterestRateAccumulator();
        liqOpp = _checkLiquidation(vault, oracleValue, newInterestRateAccumulator);
    }

    // For liquidators: should return the max amount to liquidate
    // TODO check Euler interface for this: liquidation status
    function _checkLiquidation(
        Vault memory vault,
        uint256 oracleValue,
        uint256 newInterestRateAccumulator
    ) internal view returns (LiquidationOpportunity memory liqOpp) {
        (bool solvent, uint256 currentDebt, uint256 collateralAmount, uint256 collateralAmountInStable) = _isSolvent(
            vault,
            oracleValue,
            newInterestRateAccumulator
        );
        if (!solvent) {
            // TODO improve: duplicate amount read, can do far far better
            uint256 healthFactor = (collateralAmountInStable * collateralFactor) / currentDebt;
            uint256 liquidationDiscount = (liquidationBooster * (BASE_PARAMS - healthFactor)) / BASE_PARAMS;
            liquidationDiscount = liquidationDiscount >= maxLiquidationDiscount
                ? maxLiquidationDiscount
                : liquidationDiscount;
            // This is the max amount to repay that will bring the person to the target health factor
            uint256 maxAmountToRepay = (((targetHealthFactor * currentDebt) /
                collateralFactor -
                collateralAmountInStable) * BASE_PARAMS) /
                (((BASE_PARAMS - liquidationFee) * targetHealthFactor) /
                    collateralFactor -
                    BASE_PARAMS**2 /
                    (BASE_PARAMS - liquidationDiscount));
            // Now we need to look for extreme cases
            // First with this in mind, we need to check for the dust
            uint256 maxAmountToRepayLessSurcharge = (maxAmountToRepay * (BASE_PARAMS - liquidationFee)) / BASE_PARAMS;
            // Make sure that we're not repaying more than the debt of the person
            // TODO need to check if by doing this, we're robust to all conditions and obviously improve the way things are written here
            // That's the threshold amount: below this amount it's ok, but if you go above then you need to liquidate the full amount
            uint256 thresholdAmountToRepay = 0;
            if (currentDebt <= maxAmountToRepayLessSurcharge + dust) {
                maxAmountToRepay = (currentDebt * BASE_PARAMS) / (BASE_PARAMS - liquidationFee);
                // In this case the threshold amount is such that it leaves just enough dust -> again we need to see the math for it and for if the function is increasing
                thresholdAmountToRepay = ((currentDebt - dust) * BASE_PARAMS) / (BASE_PARAMS - liquidationFee);
            }
            // Make sure that we won't be giving more than the collateral in the vault
            if (collateralAmountInStable * (BASE_PARAMS - liquidationDiscount) <= maxAmountToRepay * BASE_PARAMS) {
                maxAmountToRepay = (collateralAmountInStable * (BASE_PARAMS - liquidationDiscount)) / BASE_PARAMS;
            } else if (
                collateralAmountInStable - (maxAmountToRepay * BASE_PARAMS) / (BASE_PARAMS - liquidationDiscount) <=
                ((currentDebt - maxAmountToRepay) * (BASE_PARAMS - liquidationFee) * dustHealthFactor) /
                    (BASE_PARAMS**2)
            ) {
                // We're in the situation where a liquidation would leave not enough collateral in the vault, in which case we make sure to liquidate all remaining collateral
                // TODO in this situation: just check that
                maxAmountToRepay = (collateralAmountInStable * (BASE_PARAMS - liquidationDiscount)) / BASE_PARAMS;
                // In this case the threshold amount to repay is such that there's just enough collateral in the vault
                thresholdAmountToRepay =
                    (((currentDebt * dustHealthFactor) / BASE_PARAMS - collateralAmountInStable) * BASE_PARAMS) /
                    (((BASE_PARAMS - liquidationFee) * dustHealthFactor) /
                        BASE_PARAMS -
                        BASE_PARAMS**2 /
                        (BASE_PARAMS - liquidationDiscount));
            }
            liqOpp.maxStablecoinAmountToRepay = maxAmountToRepay;
            liqOpp.maxCollateralAmountGiven =
                (maxAmountToRepay * BASE_PARAMS * collatBase) /
                (oracleValue * (BASE_PARAMS - liquidationDiscount));
            liqOpp.healthScore = healthFactor;
            liqOpp.discount = liquidationDiscount;
            liqOpp.thresholdRepayAmount = thresholdAmountToRepay;
            liqOpp.collateralAmount = collateralAmount;
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
