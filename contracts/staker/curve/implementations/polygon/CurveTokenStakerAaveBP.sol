// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.12;

import "../../CurveTokenStaker.sol";

/// @title CurveTokenStakerAaveBP
/// @author Angle Labs, INc
/// @dev Implementation of `CurveTokenStaker` for the Aave BP pool
contract CurveTokenStakerAaveBP is CurveTokenStaker {
    // ============================= VIRTUAL FUNCTIONS =============================

    /// @inheritdoc BorrowStaker
    function asset() public pure override returns (IERC20) {
        return IERC20(0xE7a24EF0C5e95Ffb0f6684b813A78F2a3AD7D171);
    }

    function liquidityGauge() public pure override returns (ILiquidityGauge) {
        return ILiquidityGauge(address(0));
    }
}
