// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.12;

import "./SanTokenERC4626Adapter.sol";

/// @title SanTokenERC4626AdapterStakable
/// @author Angle Labs, Inc.
/// @notice IERC4626 Adapter for SanTokens of the Angle Protocol
/// @dev In this implementation, sanTokens are staked and accumulate ANGLE rewards on top of the native rewards
/// @dev Rewards are claimed at every transfer or withdrawal
/// @dev This implementation could be generalized if multiple reward tokens are sent in the liquidity gauge contract
abstract contract SanTokenERC4626AdapterStakable is SanTokenERC4626Adapter {
    using MathUpgradeable for uint256;
    using SafeERC20 for IERC20;

    /// @notice Angle-related constants
    IERC20 private constant _ANGLE = IERC20(0x31429d1856aD1377A8A0079410B297e1a9e214c2);

    uint256 internal constant _BASE_36 = 10**36;

    // ================================= REFERENCES ================================

    /// @notice Maps each reward token to a track record of cumulated rewards
    mapping(IERC20 => uint256) public integral;
    /// @notice Maps pairs of `(token,user)` to the currently pending claimable rewards
    mapping(IERC20 => mapping(address => uint256)) public pendingRewardsOf;
    /// @notice Maps pairs of `(token,user)` to a track record of cumulated personal rewards
    mapping(IERC20 => mapping(address => uint256)) public integralOf;

    uint256[47] private __gapStakable;

    /// @inheritdoc SanTokenERC4626Adapter
    function totalAssets() public view override returns (uint256) {
        return _convertToAssetsWithSlippage(IERC20(address(gauge())).balanceOf(address(this)));
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
        _claimContractRewards();
        _checkpointRewardsUser(_from, _claim);
        _checkpointRewardsUser(_to, _claim);
        // If the user is withdrawing, we need to unstake from the gauge
        if (_to == address(0)) gauge().withdraw(amount, false);
        if (_from == address(0)) gauge().deposit(amount, address(this), false);
    }

    // ================================ USER ACTIONS ===============================

    /// @notice Claims earned rewards for user `from`
    /// @param from Address to claim for
    /// @return rewardAmounts Amounts of each reward token claimed by the user
    //solhint-disable-next-line
    function claim_rewards(address from) external returns (uint256[] memory) {
        _claimContractRewards();
        return _checkpointRewardsUser(from, true);
    }

    /// @notice Returns the exact amount that will be received if calling `claim_rewards(from)` for a specific reward token
    /// @param user Address to claim for
    /// @param _rewardToken Token to get rewards for
    function claimableRewards(address user, IERC20 _rewardToken) external view returns (uint256) {
        uint256 _totalSupply = totalSupply();
        uint256 newIntegral = _totalSupply != 0
            ? integral[_rewardToken] + (_rewardsToBeClaimed(_rewardToken) * _BASE_36) / _totalSupply
            : integral[_rewardToken];
        uint256 newClaimable = (balanceOf(user) * (newIntegral - integralOf[_rewardToken][user])) / _BASE_36;
        return pendingRewardsOf[_rewardToken][user] + newClaimable;
    }

    // ======================== INTERNAL ACCOUNTING HELPERS ========================

    /// @notice Checkpoints rewards earned by a user
    /// @param user Address to claim rewards for
    /// @param _claim Whether to claim or not the rewards
    /// @return rewardAmounts Amounts of the different reward tokens earned by the user
    function _checkpointRewardsUser(address user, bool _claim) internal returns (uint256[] memory rewardAmounts) {
        IERC20[] memory rewardTokens = _getRewards();
        uint256 rewardTokensLength = rewardTokens.length;
        rewardAmounts = new uint256[](rewardTokensLength);
        if (user == address(0)) return rewardAmounts;
        uint256 userBalance = balanceOf(user);
        for (uint256 i; i < rewardTokensLength; ++i) {
            uint256 totalClaimable = (userBalance * (integral[rewardTokens[i]] - integralOf[rewardTokens[i]][user])) /
                _BASE_36 +
                pendingRewardsOf[rewardTokens[i]][user];
            if (totalClaimable != 0) {
                if (_claim) {
                    pendingRewardsOf[rewardTokens[i]][user] = 0;
                    rewardTokens[i].safeTransfer(user, totalClaimable);
                } else {
                    pendingRewardsOf[rewardTokens[i]][user] = totalClaimable;
                }
                rewardAmounts[i] = totalClaimable;
            }
            integralOf[rewardTokens[i]][user] = integral[rewardTokens[i]];
        }
    }

    /// @notice Claims all available rewards and increases the associated integral
    function _claimContractRewards() internal virtual {
        gauge().claim_rewards(address(this), address(0));
        IERC20[] memory rewardTokens = _getRewards();
        uint256 rewardTokensLength = rewardTokens.length;
        for (uint256 i; i < rewardTokensLength; ++i) {
            IERC20 rewardToken = rewardTokens[i];
            uint256 prevBalance = rewardToken.balanceOf(address(this));
            uint256 rewards = rewardToken.balanceOf(address(this)) - prevBalance;
            _updateRewards(rewardToken, rewards);
        }
    }

    /// @notice Adds the contract claimed rewards to the distributed rewards
    /// @param rewardToken Reward token that must be updated
    /// @param amount Amount to add to the claimable rewards
    function _updateRewards(IERC20 rewardToken, uint256 amount) internal {
        uint256 _totalSupply = totalSupply();
        if (_totalSupply != 0) integral[rewardToken] += (amount * _BASE_36) / _totalSupply;
    }

    /// @notice Gets the reward tokens given in the liquidity gauge
    function _getRewards() internal pure virtual returns (IERC20[] memory rewards) {
        rewards = new IERC20[](1);
        rewards[0] = _ANGLE;
        return rewards;
    }

    /// @notice Checks all unclaimed rewards in `rewardToken`
    function _rewardsToBeClaimed(IERC20 rewardToken) internal view virtual returns (uint256 amount) {
        return gauge().claimable_reward(address(this), address(rewardToken));
    }
}
