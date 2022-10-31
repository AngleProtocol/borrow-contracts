// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.12;

import "../SanTokenStaker.sol";

/// @title ConvexTokenStaker
/// @author Angle Core Team
/// @dev Implementation of `ConvexTokenStaker` for the agEUR-EUROC pool
contract SanTokenUSDCvAgEURStaker is SanTokenStaker {
    // ============================= VIRTUAL FUNCTIONS =============================

    /// @notice Address of the Angle gauge contract on which to stake the `asset`
    function liquidityGauge() public pure override returns (ILiquidityGauge) {
        return ILiquidityGauge(0x51fE22abAF4a26631b2913E417c0560D547797a7);
    }
}
