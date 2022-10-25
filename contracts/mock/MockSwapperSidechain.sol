// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

import "../swapper/SwapperSidechain.sol";

/// @title MockSwapperSidechain
/// @author Angle Core Team
contract MockSwapperSidechain is SwapperSidechain {
    error NotImplemented();

    /// @notice Constructor of the contract
    /// @param _core Core address
    /// @param _uniV3Router UniswapV3 Router address
    /// @param _oneInch 1Inch Router address
    /// @param _angleRouter AngleRouter contract address
    constructor(
        ICoreBorrow _core,
        IUniswapV3Router _uniV3Router,
        address _oneInch,
        IAngleRouterSidechain _angleRouter
    ) SwapperSidechain(_core, _uniV3Router, _oneInch, _angleRouter) {}

    function _swapLeverage(uint256, bytes memory) internal pure override returns (uint256) {
        revert NotImplemented();
    }
}
