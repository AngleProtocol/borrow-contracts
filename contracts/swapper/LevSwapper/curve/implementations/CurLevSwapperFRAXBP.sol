// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.12;

import "../CurveLevSwapper2Tokens.sol";
import "../../../../interfaces/external/curve/IMetaPool2.sol";

/// @title CurveLevSwapperFRAXBP
/// @author Angle Core Team
/// @notice Implement a leverage swapper to gain/reduce exposure to the FRAXBP Curve LP token
contract CurveLevSwapperTemplate is CurveLevSwapper2Tokens {
    constructor(
        ICoreBorrow _core,
        IUniswapV3Router _uniV3Router,
        address _oneInch,
        IAngleRouterSidechain _angleRouter
    ) CurveLevSwapper2Tokens(_core, _uniV3Router, _oneInch, _angleRouter) {}

    /// @inheritdoc BaseLevSwapper
    function angleStaker() public pure override returns (IBorrowStaker) {
        return IBorrowStaker(address(0));
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
}
