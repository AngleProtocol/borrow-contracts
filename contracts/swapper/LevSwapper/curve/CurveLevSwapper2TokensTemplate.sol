// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.12;

import "./CurveLevSwapper2Tokens.sol";
import "../../../interfaces/external/curve/IMetaPool2.sol";

/// @author Angle Core Team
/// @notice Template leverage swapper on Curve LP tokens
/// @dev This implementation is for Curve pools with 2 tokens
contract CurveLevSwapper2TokensTemplate is CurveLevSwapper2Tokens {
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
    function tokens() public pure override returns (IERC20[2] memory) {
        return [IERC20(address(0)), IERC20(address(0))];
    }

    /// @inheritdoc CurveLevSwapper2Tokens
    function metapool() public pure override returns (IMetaPool2) {
        return IMetaPool2(address(0));
    }

    /// @inheritdoc CurveLevSwapper2Tokens
    function lpToken() public pure override returns (IERC20) {
        return IERC20(address(0));
    }
}
