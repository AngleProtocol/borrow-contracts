// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.12;

import "../../interfaces/ILiquidityGauge.sol";

import "../BorrowStaker.sol";

/// @title SanTokenStaker
/// @author Angle Core Team
/// @dev Borrow staker adapted to sanToken deposited on the liquidity gauge associated
abstract contract SanTokenStaker is BorrowStaker {
    /// @notice Angle-related constants
    IERC20 private constant _ANGLE = IERC20(0x31429d1856aD1377A8A0079410B297e1a9e214c2);

    // ============================= INTERNAL FUNCTIONS ============================

    /// @inheritdoc ERC20Upgradeable
    function _afterTokenTransfer(
        address from,
        address,
        uint256 amount
    ) internal override {
        // Stake on the gauge if it is a deposit
        if (from == address(0)) {
            // Deposit the sanTokens into the liquidity gauge contract
            _changeAllowance(asset(), address(liquidityGauge()), amount);
            liquidityGauge().deposit(amount, address(this), true);
        }
    }

    /// @inheritdoc BorrowStaker
    function _withdrawFromProtocol(uint256 amount) internal override {
        liquidityGauge().withdraw(amount, false);
    }

    /// @inheritdoc BorrowStaker
    /// @dev Should be overriden by the implementation if there are more rewards
    function _claimRewards() internal virtual override {
        uint256 prevBalanceAngle = _ANGLE.balanceOf(address(this));
        liquidityGauge().claim_rewards(address(this), address(0));
        uint256 angleRewards = _ANGLE.balanceOf(address(this)) - prevBalanceAngle;
        // Do the same thing for additional rewards
        _updateRewards(_ANGLE, angleRewards);
    }

    /// @inheritdoc BorrowStaker
    function _getRewards() internal pure override returns (IERC20[] memory rewards) {
        rewards = new IERC20[](1);
        rewards[0] = _ANGLE;
        return rewards;
    }

    /// @inheritdoc BorrowStaker
    function _rewardsToBeClaimed(IERC20 rewardToken) internal view override returns (uint256 amount) {
        amount = liquidityGauge().claimable_reward(address(this), address(rewardToken));
    }

    // ============================= VIRTUAL FUNCTIONS =============================

    /// @notice Address of the liquidity gauge contract on which to deposit the tokens to get the rewards
    function liquidityGauge() public view virtual returns (ILiquidityGauge);
}
