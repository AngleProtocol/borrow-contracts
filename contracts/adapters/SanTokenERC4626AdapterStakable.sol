// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.8.12;

import "./SanTokenERC4626Adapter.sol";

import "../interfaces/coreModule/ILiquidityGauge.sol";

/// @title SanTokenERC4626AdapterStakable
/// @author Angle Labs, Inc.
/// @notice IERC4626 Adapter for SanTokens of the Angle Protocol
/// @dev In this implementation, sanTokens are staked and accumulate ANGLE rewards on top of the native rewards
/// @dev Rewards are claimed at every transfer or withdrawal
/// @dev This implementation could be generalized if multiple reward tokens are sent in the liquidity gauge contract
contract SanTokenERC4626AdapterStakable is SanTokenERC4626Adapter {
    using MathUpgradeable for uint256;
    using SafeERC20 for IERC20;

    /// @notice Angle-related constants
    IERC20 private constant _ANGLE = IERC20(0x31429d1856aD1377A8A0079410B297e1a9e214c2);

    // ================================= REFERENCES ================================

    /// @notice Gauge in which sanTokens are staked
    ILiquidityGauge public gauge;
    /// @notice Maps each reward token to a track record of cumulated rewards
    mapping(IERC20 => uint256) public integral;
    /// @notice Maps pairs of `(token,user)` to the currently pending claimable rewards
    mapping(IERC20 => mapping(address => uint256)) public pendingRewardsOf;
    /// @notice Maps pairs of `(token,user)` to a track record of cumulated personal rewards
    mapping(IERC20 => mapping(address => uint256)) public integralOf;

    // =================================== ERRORS ==================================

    error ZeroAddress();

    uint256[45] private __gapStakable;

    /// @notice Initializes the contract
    function initializeStakable(
        ILiquidityGauge _gauge,
        address _stableMaster,
        address _poolManager
    ) public {
        if (address(_gauge) == address(0)) revert ZeroAddress();
        address sanToken = initialize(_stableMaster, _poolManager);
        gauge = _gauge;
        IERC20(sanToken).safeIncreaseAllowance(address(_gauge), type(uint256).max);
    }

    // ================================ ERC20 LOGIC ================================

    /// @inheritdoc ERC20Upgradeable
    function _beforeTokenTransfer(
        address _from,
        address _to,
        uint256 amount
    ) internal override {
        // Not claiming only if it is a deposit
        bool _claim = !(_from == address(0));
        address[] memory checkpointUser = new address[](2);
        checkpointUser[0] = _from;
        checkpointUser[1] = _to;
        _checkpoint(checkpointUser, _claim);
        // If the user is withdrawing, we need to unstake from the gauge
        if (_to == address(0)) gauge.withdraw(amount, false);
        if (_from == address(0)) gauge.deposit(amount, address(this), false);
    }

    // ================================ USER ACTIONS ===============================

    /// @notice Claims earned rewards for user `from`
    /// @param from Address to claim for
    /// @return rewardAmounts Amounts of each reward token claimed by the user
    //solhint-disable-next-line
    function claim_rewards(address from) external returns (uint256[] memory) {
        address[] memory checkpointUser = new address[](1);
        checkpointUser[0] = address(from);
        return _checkpoint(checkpointUser, true);
    }

    /// @notice Returns the exact amount that will be received if calling `claim_rewards(from)` for a specific reward token
    /// @param from Address to claim for
    /// @param _rewardToken Token to get rewards for
    function claimableRewards(address from, IERC20 _rewardToken) external view returns (uint256) {
        uint256 _totalSupply = totalSupply();
        uint256 newIntegral = _totalSupply != 0
            ? integral[_rewardToken] + (_rewardsToBeClaimed(_rewardToken) * _BASE_PARAMS) / _totalSupply
            : integral[_rewardToken];
        uint256 newClaimable = (balanceOf(from) * (newIntegral - integralOf[_rewardToken][from])) / _BASE_PARAMS;
        return pendingRewardsOf[_rewardToken][from] + newClaimable;
    }

    // ======================== INTERNAL ACCOUNTING HELPERS ========================

    /// @notice Claims contracts rewards and checkpoints rewards for different `accounts`
    /// @param accounts Array of accounts we should checkpoint rewards for
    /// @param _claim Whether to claim for `accounts` the pending rewards
    /// @return rewardAmounts An array representing the rewards earned by the first address in the `accounts` array
    /// on each of the reward token
    function _checkpoint(address[] memory accounts, bool _claim) internal returns (uint256[] memory rewardAmounts) {
        _claimRewards();
        uint256 accountsLength = accounts.length;
        for (uint256 i; i < accountsLength; ++i) {
            if (accounts[i] == address(0)) continue;
            if (i == 0) rewardAmounts = _checkpointRewardsUser(accounts[i], _claim);
            else _checkpointRewardsUser(accounts[i], _claim);
        }
    }

    /// @notice Checkpoints rewards earned by a user
    /// @param from Address to claim rewards from
    /// @param _claim Whether to claim or not the rewards
    /// @return rewardAmounts Amounts of the different reward tokens earned by the user
    function _checkpointRewardsUser(address from, bool _claim) internal returns (uint256[] memory rewardAmounts) {
        IERC20[] memory rewardTokens = _getRewards();
        uint256 rewardTokensLength = rewardTokens.length;
        rewardAmounts = new uint256[](rewardTokensLength);
        uint256 userBalance = balanceOf(from);
        for (uint256 i; i < rewardTokensLength; ++i) {
            uint256 newClaimable = (userBalance * (integral[rewardTokens[i]] - integralOf[rewardTokens[i]][from])) /
                _BASE_PARAMS;
            uint256 previousClaimable = pendingRewardsOf[rewardTokens[i]][from];
            if (_claim && previousClaimable + newClaimable != 0) {
                pendingRewardsOf[rewardTokens[i]][from] = 0;
                rewardTokens[i].safeTransfer(from, previousClaimable + newClaimable);
            } else if (newClaimable != 0) {
                pendingRewardsOf[rewardTokens[i]][from] += newClaimable;
            }
            integralOf[rewardTokens[i]][from] = integral[rewardTokens[i]];
            rewardAmounts[i] = previousClaimable + newClaimable;
        }
    }

    /// @notice Adds the contract claimed rewards to the distributed rewards
    /// @param rewardToken Reward token that must be updated
    /// @param amount Amount to add to the claimable rewards
    function _updateRewards(IERC20 rewardToken, uint256 amount) internal {
        uint256 _totalSupply = totalSupply();
        if (_totalSupply != 0) integral[rewardToken] += (amount * _BASE_PARAMS) / _totalSupply;
    }

    /// @notice Claims all available rewards and increases the associated integral
    function _claimRewards() internal virtual {
        uint256 prevBalanceAngle = _ANGLE.balanceOf(address(this));
        gauge.claim_rewards(address(this), address(0));
        uint256 angleRewards = _ANGLE.balanceOf(address(this)) - prevBalanceAngle;
        // Do the same thing for additional rewards
        _updateRewards(_ANGLE, angleRewards);
    }

    /// @notice Gets the reward tokens given in the liquidity gauge
    function _getRewards() internal pure virtual returns (IERC20[] memory rewards) {
        rewards = new IERC20[](1);
        rewards[0] = _ANGLE;
        return rewards;
    }

    /// @notice Checks all unclaimed rewards in `rewardToken`
    function _rewardsToBeClaimed(IERC20 rewardToken) internal view virtual returns (uint256 amount) {
        return gauge.claimable_reward(address(this), address(rewardToken));
    }
}
