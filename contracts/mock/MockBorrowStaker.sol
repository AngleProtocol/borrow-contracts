// SPDX-License-Identifier: AGPL-3.0-only

pragma solidity 0.8.12;

import "../staker/BorrowStaker.sol";

/// @title MockBorrowStaker
/// @author Angle Core Team
contract MockBorrowStaker is BorrowStaker {
    using SafeERC20 for IERC20;

    IERC20 public rewardToken;
    uint256 public rewardAmount;

    /// @inheritdoc BorrowStaker
    function _withdrawFromProtocol(uint256 amount) internal override {}

    /// @inheritdoc BorrowStaker
    /// @dev Should be overriden by the implementation if there are more rewards
    function _claimRewards() internal virtual override {
        _updateRewards(rewardToken, rewardAmount);
    }

    /// @inheritdoc BorrowStaker
    function _getRewards() internal view override returns (IERC20[] memory rewards) {
        rewards = new IERC20[](1);
        rewards[0] = rewardToken;
        return rewards;
    }

    /// @inheritdoc BorrowStaker
    function _rewardsToBeClaimed(IERC20) internal view override returns (uint256 amount) {
        amount = rewardAmount;
    }

    function setRewardToken(IERC20 token) public {
        rewardToken = token;
    }

    function setRewardAmount(uint256 amount) public {
        rewardAmount = amount;
    }
}
