// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.12;

import "../swapper/LevSwapper/curve/CurveLevSwapper2Tokens.sol";
import "../interfaces/external/curve/IMetaPool2.sol";

/// @title CurveLevSwapperFRAXBP
/// @author Angle Core Team
/// @notice Implement a leverage swapper to gain/reduce exposure to the FRAXBP Curve LP token
contract MockCurveLevSwapper2Tokens is CurveLevSwapper2Tokens {
    IBorrowStaker internal _angleStaker;

    constructor(
        ICoreBorrow _core,
        IUniswapV3Router _uniV3Router,
        address _oneInch,
        IAngleRouterSidechain _angleRouter,
        IBorrowStaker angleStaker_
    ) CurveLevSwapper2Tokens(_core, _uniV3Router, _oneInch, _angleRouter) {
        _angleStaker = angleStaker_;
    }

    /// @inheritdoc BaseLevSwapper
    function angleStaker() public view override returns (IBorrowStaker) {
        return _angleStaker;
    }

    /// @inheritdoc CurveLevSwapper2Tokens
    function token1() public pure override returns (IERC20) {
        return IERC20(0x853d955aCEf822Db058eb8505911ED77F175b99e);
    }

    /// @inheritdoc CurveLevSwapper2Tokens
    function token2() public pure override returns (IERC20) {
        return IERC20(address(0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48));
    }

    /// @inheritdoc CurveLevSwapper2Tokens
    function metapool() public pure override returns (IMetaPool2) {
        return IMetaPool2(0xDcEF968d416a41Cdac0ED8702fAC8128A64241A2);
    }

    /// @inheritdoc CurveLevSwapper2Tokens
    function lpToken() public pure override returns (IERC20) {
        return IERC20(0x3175Df0976dFA876431C2E9eE6Bc45b65d3473CC);
    }

    function setAngleStaker(IBorrowStaker angleStaker_) public {
        _angleStaker = angleStaker_;
    }
}
