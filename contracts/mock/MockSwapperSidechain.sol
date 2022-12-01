// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

import "../swapper/Swapper.sol";

/// @title MockSwapperSidechain
/// @author Angle Labs, Inc.
contract MockSwapperSidechain is Swapper {
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
    ) Swapper(_core, _uniV3Router, _oneInch, _angleRouter) {}

    function _swapLeverage(bytes memory) internal pure override returns (uint256) {
        revert NotImplemented();
    }
}
