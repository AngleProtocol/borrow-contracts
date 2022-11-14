// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.12;

import "../swapper/LevSwapper/curve/CurveLevSwapper5TokensWithBP.sol";
import "../interfaces/external/curve/ITricrypto3.sol";

/// @title CurveLevSwapperFRAXBP
/// @author Angle Labs, Inc
/// @notice Implement a leverage swapper to gain/reduce exposure to the Polygon tricrypto2 Curve LP token
contract MockCurveLevSwapper5TokensWithBP is CurveLevSwapper5TokensWithBP {
    IBorrowStaker internal _angleStaker;

    constructor(
        ICoreBorrow _core,
        IUniswapV3Router _uniV3Router,
        address _oneInch,
        IAngleRouterSidechain _angleRouter,
        IBorrowStaker angleStaker_
    ) CurveLevSwapper5TokensWithBP(_core, _uniV3Router, _oneInch, _angleRouter) {
        _angleStaker = angleStaker_;
    }

    /// @inheritdoc BaseLevSwapper
    function angleStaker() public view override returns (IBorrowStaker) {
        return _angleStaker;
    }

    /// @inheritdoc CurveLevSwapper5TokensWithBP
    function tokens() public pure override returns (IERC20[3] memory) {
        return [
            // LP token Aave BP Pool
            IERC20(0xE7a24EF0C5e95Ffb0f6684b813A78F2a3AD7D171),
            // WBTC
            IERC20(0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6),
            // WETH
            IERC20(0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619)
        ];
    }

    /// @inheritdoc CurveLevSwapper5TokensWithBP
    function metapool() public pure override returns (ITricrypto3) {
        return ITricrypto3(0x1d8b86e3D88cDb2d34688e87E72F388Cb541B7C8);
    }

    /// @inheritdoc CurveLevSwapper5TokensWithBP
    function lpToken() public pure override returns (IERC20) {
        return IERC20(0xdAD97F7713Ae9437fa9249920eC8507e5FbB23d3);
    }

    /// @inheritdoc CurveLevSwapper5TokensWithBP
    function tokensBP() public pure override returns (IERC20[3] memory) {
        return [
            // amDAI (Aave market)
            IERC20(0x27F8D03b3a2196956ED754baDc28D73be8830A6e),
            // amUSDC (Aave market)
            IERC20(0x1a13F4Ca1d028320A707D99520AbFefca3998b7F),
            // amUSDT (Aave market)
            IERC20(0x60D55F02A771d515e077c9C2403a1ef324885CeC)
        ];
    }

    function setAngleStaker(IBorrowStaker angleStaker_) public {
        _angleStaker = angleStaker_;
    }
}
