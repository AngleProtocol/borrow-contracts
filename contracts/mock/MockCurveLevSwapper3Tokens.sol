// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.12;

import "../swapper/LevSwapper/curve/implementations/polygon/CurveLevSwapperAaveBP.sol";

/// @title CurveLevSwapperAavePool
/// @author Angle Labs, Inc.
/// @notice Implement a leverage swapper to gain/reduce exposure to the Aave BP (amUSDC - amUSDT - amDAI) Curve LP token
contract MockCurveLevSwapper3Tokens is CurveLevSwapperAaveBP {
    IBorrowStaker internal _angleStaker;

    constructor(
        ICoreBorrow _core,
        IUniswapV3Router _uniV3Router,
        address _oneInch,
        IAngleRouterSidechain _angleRouter,
        IBorrowStaker angleStaker_
    ) CurveLevSwapperAaveBP(_core, _uniV3Router, _oneInch, _angleRouter) {
        _angleStaker = angleStaker_;
    }

    /// @inheritdoc BaseLevSwapper
    function angleStaker() public view override returns (IBorrowStaker) {
        return _angleStaker;
    }

    function setAngleStaker(IBorrowStaker angleStaker_) public {
        _angleStaker = angleStaker_;
    }
}
