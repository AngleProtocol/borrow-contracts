// SPDX-License-Identifier: AGPL-3.0-only

pragma solidity 0.8.12;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/IERC721ReceiverUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/MathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import "../interfaces/IVaultManager.sol";

/// @title BaseReactorStorage
/// @author Angle Core Team
/// @dev Variables, references, parameters and events needed in the `BaseReactor` contract
// solhint-disable-next-line max-states-count
contract BorrowStakerStorage is Initializable, ReentrancyGuardUpgradeable {
    /// @notice Base used for parameter computation
    uint256 public constant BASE_PARAMS = 10**9;

    // ================================= REFERENCES ================================

    /// @notice Reference to the asset controlled by this reactor
    IERC20 public asset;
    /// @notice Treasury contract handling access control
    ITreasury public treasury;
    /// @notice Base of the `asset`. While it is assumed in this contract that the base of the stablecoin is 18,
    /// the base of the `asset` may not be 18
    uint256 internal _assetBase;

    // ================================= VARIABLES =================================

    /// @notice Mapping each token to a track record of cumulated rewards
    mapping(IERC20 => uint256) public integral;
    /// @notice Mapping for each token an address current pending claimable rewards
    mapping(IERC20 => mapping(address => uint256)) public pendingRewardsOf;
    /// @notice Mapping for each token and address, a track record of personal rewards
    mapping(IERC20 => mapping(address => uint256)) public integralOf;

    uint256[43] private __gap;

    event Deposit(address indexed from, address indexed to, uint256 amount);
    event Withdraw(address indexed from, address indexed to, uint256 amount);
    event Recovered(address indexed token, address indexed to, uint256 amount);

    // =============================== Errors ======================================

    error InvalidParameterValue();
    error InvalidParameterType();
    error InvalidSetOfParameters();
    error InvalidToken();
    error NotGovernor();
    error NotGovernorOrGuardian();
    error NotVaultManager();
    error TooHighParameterValue();
    error TransferAmountExceedsAllowance();
    error ZeroAddress();
    error ZeroAssets();
    error ZeroShares();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() initializer {}
}
