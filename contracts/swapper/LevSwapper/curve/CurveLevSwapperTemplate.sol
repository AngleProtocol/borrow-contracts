// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.12;

import "./CurveLevSwapper.sol";
import "../../../interfaces/external/curve/IMetaPool2.sol";

/// @author Angle Core Team
/// @notice Template leverage swapper on Curve LP tokens with Convex
contract CurveLevSwapperTemplate is CurveLevSwapper {
    constructor(
        ICoreBorrow _core,
        IUniswapV3Router _uniV3Router,
        address _oneInch,
        IAngleRouterSidechain _angleRouter
    ) CurveLevSwapper(_core, _uniV3Router, _oneInch, _angleRouter) {}

    /// @inheritdoc BaseLevSwapper
    function angleStaker() public pure override returns (IBorrowStaker) {
        return IBorrowStaker(address(0));
    }

    /// @inheritdoc CurveLevSwapper
    function token1() public pure override returns (IERC20) {
        return IERC20(address(0));
    }

    /// @inheritdoc CurveLevSwapper
    function token2() public pure override returns (IERC20) {
        return IERC20(address(0));
    }

    /// @inheritdoc CurveLevSwapper
    function metapool() public pure override returns (IMetaPool2) {
        return IMetaPool2(address(0));
    }
}
