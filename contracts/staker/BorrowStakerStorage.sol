// SPDX-License-Identifier: AGPL-3.0-only

pragma solidity 0.8.12;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import "../interfaces/ICoreBorrow.sol";

/// @title BaseStorage
/// @author Angle Core Team
/// @dev Variables, references, parameters and events needed in the `BorrowStaker` contract
contract BorrowStakerStorage is Initializable {
    /// @notice Base used for parameter computation
    /// @dev Large base because when `(amount * BASE_PARAMS) / totalSupply()` if `amount << totalSupply`
    /// rounding can be terrible. Setting the base higher limits the maximum decimals a reward can have - overflows.
    uint256 public constant BASE_PARAMS = 10**36;

    // ================================= REFERENCES ================================

    /// @notice Reference to the staked token
    IERC20 public asset;
    /// @notice Core borrow contract handling access control
    ICoreBorrow public coreBorrow;

    // ================================= VARIABLES =================================

    /// @notice Token decimal
    uint8 internal _decimals;
    /// @notice Maps each reward token to a track record of cumulated rewards
    mapping(IERC20 => uint256) public integral;
    /// @notice Maps pairs of `(token,user)` to the currently pending claimable rewards
    mapping(IERC20 => mapping(address => uint256)) public pendingRewardsOf;
    /// @notice Maps pairs of `(token,user)` to a track record of cumulated personal rewards
    mapping(IERC20 => mapping(address => uint256)) public integralOf;

    uint256[43] private __gap;

    // =================================== EVENTS ==================================

    event Deposit(address indexed from, address indexed to, uint256 amount);
    event Withdraw(address indexed from, address indexed to, uint256 amount);
    event Recovered(address indexed token, address indexed to, uint256 amount);

    // =================================== ERRROS ==================================

    error InvalidToken();
    error NotGovernor();
    error TransferAmountExceedsAllowance();
    error ZeroAddress();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() initializer {}
}
