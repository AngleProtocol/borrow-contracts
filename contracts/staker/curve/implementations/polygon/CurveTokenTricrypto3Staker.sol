// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.12;

import "../../CurveTokenStaker.sol";

/// @title CurveTokenTricrypto3Staker
/// @author Angle Labs, Inc
/// @dev Implements CurveTokenStaker for the Tricrypto pool (amUSD - amWBTC - amWETH)
contract CurveTokenTricrypto3Staker is CurveTokenStaker {
    /// @inheritdoc CurveTokenStaker
    function liquidityGauge() public pure override returns (ILiquidityGauge) {
        return ILiquidityGauge(0xBb1B19495B8FE7C402427479B9aC14886cbbaaeE);
    }
}
