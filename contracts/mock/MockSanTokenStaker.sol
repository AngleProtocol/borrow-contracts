// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.12;

import "../staker/angle/SanTokenStaker.sol";

/// @title ConvexTokenStaker
/// @author Angle Core Team
contract MockSanTokenStaker is SanTokenStaker {
    /// @dev use the sanUSDCEUR gauge
    function liquidityGauge() public pure override returns (ILiquidityGauge) {
        return ILiquidityGauge(0x51fE22abAF4a26631b2913E417c0560D547797a7);
    }
}
