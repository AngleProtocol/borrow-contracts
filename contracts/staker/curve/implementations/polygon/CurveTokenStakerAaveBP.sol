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
        return IERC20(0xBa3436Fd341F2C8A928452Db3C5A3670d1d5Cc73);
    }

    function liquidityGauge() public pure override returns (ILiquidityGauge) {
        return ILiquidityGauge(0x20759F567BB3EcDB55c817c9a1d13076aB215EdC);
    }
}
