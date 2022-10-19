// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.12;

import "../swapper/LevSwapper/BaseLevSwapper.sol";

/// @title MockBaseLevSwapper
/// @author Angle Core Team
abstract contract MockBaseLevSwapper is BaseLevSwapper {
    using SafeERC20 for IERC20;

    constructor(
        ICoreBorrow _core,
        IUniswapV3Router _uniV3Router,
        address _oneInch,
        IAngleRouterSidechain _angleRouter
    ) BaseLevSwapper(_core, _uniV3Router, _oneInch, _angleRouter) {}

    /// @inheritdoc BaseLevSwapper
    function _add(bytes memory data) internal override returns (uint256 amountOut) {}

    /// @inheritdoc BaseLevSwapper
    function _remove(uint256 amount, bytes memory data) internal override returns (uint256 amountOut) {}
}
