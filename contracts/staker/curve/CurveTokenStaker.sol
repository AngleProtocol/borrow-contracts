// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.12;

import "../../interfaces/ILiquidityGauge.sol";

import "../BorrowStaker.sol";

/// @title CurveTokenStaker
/// @author Angle Labs, Inc
/// @dev Borrow staker adapted to curve LP token deposited on the liquidity gauge associated
abstract contract CurveTokenStaker is BorrowStaker {
    /// @notice Curve-related constants
    IERC20 private constant _CRV = IERC20(0xD533a949740bb3306d119CC777fa900bA034cd52);

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
            _changeAllowance(asset, address(liquidityGauge()), amount);
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
        uint256 prevBalanceAngle = _CRV.balanceOf(address(this));
        liquidityGauge().claim_rewards(address(this), address(0));
        uint256 angleRewards = _CRV.balanceOf(address(this)) - prevBalanceAngle;
        // Do the same thing for additional rewards
        _updateRewards(_CRV, angleRewards);
    }

    /// @inheritdoc BorrowStaker
    function _getRewards() internal pure override returns (IERC20[] memory rewards) {
        rewards = new IERC20[](1);
        rewards[0] = _CRV;
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
