// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/draft-IERC20PermitUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/IERC721ReceiverUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/interfaces/IERC721MetadataUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/introspection/IERC165Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/AddressUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../interfaces/IAgToken.sol";
import "../interfaces/IOracle.sol";
import "../interfaces/ISwapper.sol";
import "../interfaces/IInterestRateModel.sol";
import "../interfaces/IBorrowingManager.sol";
import "../interfaces/ILender.sol";

/// @title VaultManagerStorage
/// @author Angle Labs, Inc.
/// @dev Variables, references, parameters and events needed in the `VaultManager` contract
// solhint-disable-next-line max-states-count
contract BorrowingManagerStorage is Initializable, ReentrancyGuardUpgradeable {
    /// @notice Base used for parameter computation: almost all the parameters of this contract are set in `BASE_PARAMS`
    uint256 public constant BASE_PARAMS = 10**9;
    /// @notice Base used for interest rate computation
    uint256 public constant BASE_INTEREST = 10**27;
    /// @notice Used for interest rate computation
    uint256 public constant HALF_BASE_INTEREST = 10**27 / 2;

    // ================================= REFERENCES ================================

    ICoreBorrow public coreBorrow;

    IERC20 public collateral;

    IERC20 public asset;

    IOracle public oracle;
    /// @notice Base of the collateral
    uint256 internal _collatBase;
    /// @notice Base of the asset
    uint256 internal _assetBase;

    ILender public lender;

    IInterestRateModel public interestRateModel;

    // ================================= PARAMETERS ================================
    // Unless specified otherwise, parameters of this contract are expressed in `BASE_PARAMS`

    /// @notice Maximum amount of stablecoins that can be issued with this contract (in `BASE_TOKENS`). This parameter should
    /// not be bigger than `type(uint256).max / BASE_INTEREST` otherwise there may be some overflows in the `increaseDebt` function
    uint256 public debtCeiling;

    uint64 public collateralFactor;
    /// @notice Maximum Health factor at which a vault can end up after a liquidation (unless it's fully liquidated)
    uint64 public targetHealthFactor;
    /// @notice Fee taken by the protocol during a liquidation. Technically, this value is not the fee per se, it's 1 - fee.
    /// For instance for a 2% fee, `liquidationSurcharge` should be 98%
    uint64 public liquidationSurcharge;
    /// @notice Maximum discount given to liquidators
    uint64 public maxLiquidationDiscount;
    /// @notice Whether the contract is paused or not
    bool public paused;

    uint64 public liquidationBoost;

    uint64 public reserveFactor;

    // ================================= VARIABLES =================================

    /// @notice Timestamp at which the `interestAccumulator` was updated
    uint256 public lastInterestAccumulatorUpdated;

    uint256 public interestAccumulator;

    uint256 public totalNormalizedDebt;

    uint256 public dust;

    /// @notice Minimum amount of collateral (in stablecoin value, e.g in `BASE_TOKENS = 10**18`) that can be left
    /// in a vault during a liquidation where the health factor function is decreasing
    uint256 internal _dustCollateral;

    // ================================== MAPPINGS =================================

    mapping(uint256 => Vault) public vaultData;

    // ================================ ERC721 DATA ================================

    uint256 public vaultIDCount;

    /// @notice URI
    string internal _baseURI;

    // Mapping from `vaultID` to owner address
    mapping(uint256 => address) internal _owners;

    // Mapping from owner address to vault owned count
    mapping(address => uint256) internal _balances;

    // Mapping from `vaultID` to approved address
    mapping(uint256 => address) internal _vaultApprovals;

    // Mapping from owner to operator approvals
    mapping(address => mapping(address => uint256)) internal _operatorApprovals;

    uint256[50] private __gap;

    // =================================== EVENTS ==================================
    event CollateralAmountUpdated(uint256 vaultID, uint256 collateralAmount, uint8 isIncrease);
    event InterestAccumulatorUpdated(uint256 value, uint256 timestamp);
    event InternalDebtUpdated(uint256 vaultID, uint256 internalAmount, uint8 isIncrease);
    event FiledUint64(uint64 param, bytes32 what);
    event DebtCeilingUpdated(uint256 debtCeiling);
    event LiquidatedVaults(uint256[] vaultIDs);

    // =================================== ERRORS ==================================

    error ApprovalToOwner();
    error ApprovalToCaller();
    error DustyLeftoverAmount();
    error DebtCeilingExceeded();
    error HealthyVault();
    error IncompatibleLengths();
    error InsolventVault();
    error InvalidParameterValue();
    error InvalidParameterType();
    error InvalidSetOfParameters();
    error NonERC721Receiver();
    error NonexistentVault();
    error NotApproved();
    error NotGovernor();
    error NotGovernorOrGuardian();
    error NotVaultManager();
    error Paused();
    error TooHighParameterValue();
    error TooSmallParameterValue();
    error ZeroAddress();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() initializer {}
}
