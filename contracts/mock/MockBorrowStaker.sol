// SPDX-License-Identifier: AGPL-3.0-only

pragma solidity 0.8.12;

import "../staker/BorrowStaker.sol";

/// @title MockBorrowStaker
/// @author Angle Core Team
contract MockBorrowStaker is BorrowStaker {
    using SafeERC20 for IERC20;

    error IncompatibleLengths();

    IERC20 public rewardToken;
    uint256 public rewardAmount;

    /// @notice Changes allowance of a set of tokens to addresses
    /// @param tokens Tokens to change allowance for
    /// @param spenders Addresses to approve
    /// @param amounts Approval amounts for each address
    /// @dev You can only change allowance for approved strategies
    function changeAllowance(
        IERC20[] calldata tokens,
        address[] calldata spenders,
        uint256[] calldata amounts
    ) external onlyGovernor {
        if (tokens.length != amounts.length || spenders.length != amounts.length || tokens.length == 0)
            revert IncompatibleLengths();
        for (uint256 i = 0; i < spenders.length; i++) {
            _changeAllowance(tokens[i], spenders[i], amounts[i]);
        }
    }

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

/// @title MockBorrowStakerReset
/// @author Angle Core Team
contract MockBorrowStakerReset is MockBorrowStaker {
    /// @inheritdoc BorrowStaker
    /// @dev Reset to 0 when rewards are claimed
    function _claimRewards() internal virtual override {
        _updateRewards(rewardToken, rewardAmount);
        rewardAmount = 0;
    }
}
