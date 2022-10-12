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
    uint256 public constant BASE_PARAMS = 10**9;

    // ================================= REFERENCES ================================

    /// @notice Reference to the staked token
    IERC20 public asset;
    /// @notice Core borrow contract handling access control
    ICoreBorrow public coreBorrow;

    // ================================= VARIABLES =================================

    /// @notice Mapping each token to a track record of cumulated rewards
    mapping(IERC20 => uint256) public integral;
    /// @notice Mapping each (token,user) current pending claimable rewards
    mapping(IERC20 => mapping(address => uint256)) public pendingRewardsOf;
    /// @notice Mapping each (token,user) a track record of cumulated personal rewards
    mapping(IERC20 => mapping(address => uint256)) public integralOf;

    uint256[43] private __gap;

    event Deposit(address indexed from, address indexed to, uint256 amount);
    event Withdraw(address indexed from, address indexed to, uint256 amount);
    event Recovered(address indexed token, address indexed to, uint256 amount);

    // =============================== Errors ======================================

    error InvalidToken();
    error NotGovernor();
    error TransferAmountExceedsAllowance();
    error ZeroAddress();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() initializer {}
}
