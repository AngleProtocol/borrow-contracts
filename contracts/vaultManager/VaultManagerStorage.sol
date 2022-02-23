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
import "../interfaces/IOracle.sol";
import "../interfaces/IRepayCallee.sol";
import "../interfaces/ITreasury.sol";
import "../interfaces/IVaultManager.sol";
import "../interfaces/IVeBoostProxy.sol";

/// @title VaultManagerERC721
/// @author Angle Core Team
/// @dev Base ERC721 Implementation of VaultManager
// solhint-disable-next-line max-states-count
contract VaultManagerStorage is IVaultManagerStorage, Initializable, PausableUpgradeable, ReentrancyGuardUpgradeable {
    /// @notice Base used for parameter computation
    uint256 public constant BASE_PARAMS = 10**9;
    /// @notice Base used for interest rate computation
    uint256 public constant BASE_INTEREST = 10**27;
    /// @notice Used for interest rate computation
    uint256 public constant HALF_BASE_INTEREST = 10**27 / 2;

    // ========================= Key Structs and Enums =============================

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

    /// @notice For a given `vaultID`, this encodes a liquidation opportunity that is to say details about the maximum
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
        // Oracle value (in stablecoin base) at the time of the liquidation
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

    /// @notice Actions possible when composing calls to the different entry functions proposed
    enum ActionType {
        createVault,
        closeVault,
        addCollateral,
        removeCollateral,
        repayDebt,
        borrow,
        getDebtIn
    }

    // =============================== References ==================================

    /// @inheritdoc IVaultManagerStorage
    ITreasury public override treasury;
    /// @notice Reference to the collateral handled by this `VaultManager`
    IERC20 public collateral;
    /// @notice Stablecoin handled by this contract. Another `VaultManager` contract could have
    /// the same rights as this `VaultManager` on the stablecoin contract
    IAgToken public stablecoin;
    /// @notice Oracle contract to get access to the price of the collateral with respect to the stablecoin
    IOracle public oracle;
    /// @notice Reference to the contract which computes adjusted veANGLE balances for liquidators boosts
    IVeBoostProxy public veBoostProxy;
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
    /// @notice Threshold veANGLE balance values for the computation of the boost for liquidators: the length of this array
    /// should be 2
    uint256[] public xLiquidationBoost;
    /// @notice Values of the liquidation boost at the threshold values of x
    uint256[] public yLiquidationBoost;
    /// @notice Encodes the maximum ratio stablecoin/collateral a vault can have before being liquidated. It's what
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

    // ================================ Mappings ===================================

    /// @notice Maps a `vaultID` to its data (namely collateral amount and normalized debt)
    mapping(uint256 => Vault) public vaultData;
    /// @notice Maps an address to whether it's whitelisted and can open or own a vault
    mapping(address => bool) public isWhitelisted;

    // =============================== Parameters ==================================

    /// @notice Whether whitelisting is required to own a vault or not
    bool public whitelistingActivated;

    // ================================ ERC721 Data ================================

    /// @notice URI
    string public baseURI;

    // Counter to generate a unique `vaultID` for each vault: `vaultID` acts as `tokenID` in basic ERC721
    // contracts
    CountersUpgradeable.Counter internal _vaultIDCount;

    // Mapping from `vaultID` to owner address
    mapping(uint256 => address) internal _owners;

    // Mapping from owner address to vault owned count
    mapping(address => uint256) internal _balances;

    // Mapping from `vaultID` to approved address
    mapping(uint256 => address) internal _vaultApprovals;

    // Mapping from owner to operator approvals
    mapping(address => mapping(address => bool)) internal _operatorApprovals;

    // =============================== Events ======================================

    event AccruedToTreasury(uint256 surplusEndValue, uint256 badDebtEndValue);
    event CollateralAmountUpdated(uint256 vaultID, uint256 collateralAmount, uint8 isIncrease);
    event InterestRateAccumulatorUpdated(uint256 value, uint256 timestamp);
    event InternalDebtUpdated(uint256 vaultID, uint256 internalAmount, uint8 isIncrease);
    event FiledUint64(uint64 param, bytes32 what);
    event FiledUint256(uint256 param, bytes32 what);
    event LiquidationBoostParametersUpdated(address indexed _veBoostProxy, uint256[] xBoost, uint256[] yBoost);
    event OracleUpdated(address indexed _oracle);
    event ToggledWhitelisting(bool);
}
