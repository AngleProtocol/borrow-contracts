// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.12;

import "./SanTokenLevSwapper.sol";
import "../../../interfaces/external/curve/IMetaPool2.sol";

/// @title Template leverage swapper on sanTokens
/// @author Angle Core Team
contract SanTokenLevSwapperTemplate is SanTokenLevSwapper {
    constructor(
        ICoreBorrow _core,
        IUniswapV3Router _uniV3Router,
        address _oneInch,
        IAngleRouterSidechain _angleRouter
    ) SanTokenLevSwapper(_core, _uniV3Router, _oneInch, _angleRouter) {}

    function stableMaster() public pure override returns (IStableMaster) {
        return IStableMaster(address(0));
    }

    function poolManager() public pure override returns (address) {
        return address(0);
    }

    function collateral() public pure override returns (IERC20) {
        return IERC20(address(0));
    }

    function sanToken() public pure override returns (IERC20) {
        return IERC20(address(0));
    }
}
