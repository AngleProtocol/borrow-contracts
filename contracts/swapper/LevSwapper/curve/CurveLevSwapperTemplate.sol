// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.12;

import "./CurveLevSwapper.sol";
import "../../../interfaces/external/curve/IMetaPool2.sol";

/// @title Leverage Swapper from agEUR to Curve LP agEUR-EUROC
/// @author Angle Core Team
contract CurveLevSwapperTemplate is CurveLevSwapper {
    constructor(
        ICoreBorrow _core,
        IUniswapV3Router _uniV3Router,
        address _oneInch,
        IAngleRouterSidechain _angleRouter
    ) CurveLevSwapper(_core, _uniV3Router, _oneInch, _angleRouter) {}

    /// @notice Reference to the `agToken` contract which route the leverage operation
    function agToken() public pure override returns (IERC20) {
        return IERC20(address(0));
    }

    /// @notice Reference to the `collateral` contract which is the counterpart token in the Curve pool
    function collateral() public pure override returns (IERC20) {
        return IERC20(address(0));
    }

    /// @notice Reference to the `collateral` contract which is the counterpart token in the Curve pool
    function metapool() public pure override returns (IMetaPool2) {
        return IMetaPool2(address(0));
    }
}
