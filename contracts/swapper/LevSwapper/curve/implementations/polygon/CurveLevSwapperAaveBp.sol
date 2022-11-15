// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.12;

import "../../CurveLevSwapper3Tokens.sol";

/// @title CurveLevSwapperAaveBP
/// @author Angle Labs, Inc.
/// @notice Implement a leverage swapper to gain/reduce exposure to the Aave BP (amUSDC - amUSDT - amDAI) Curve LP token
contract CurveLevSwapperAaveBP is CurveLevSwapper3Tokens {
    constructor(
        ICoreBorrow _core,
        IUniswapV3Router _uniV3Router,
        address _oneInch,
        IAngleRouterSidechain _angleRouter
    ) CurveLevSwapper3Tokens(_core, _uniV3Router, _oneInch, _angleRouter) {}

    /// @inheritdoc BaseLevSwapper
    function angleStaker() public view virtual override returns (IBorrowStaker) {
        return IBorrowStaker(address(0));
    }

    /// @inheritdoc CurveLevSwapper3Tokens
    function tokens() public pure override returns (IERC20[3] memory) {
        return [
            // amDAI (Aave market)
            IERC20(0x27F8D03b3a2196956ED754baDc28D73be8830A6e),
            // amUSDC (Aave market)
            IERC20(0x1a13F4Ca1d028320A707D99520AbFefca3998b7F),
            // amUSDT (Aave market)
            IERC20(0x60D55F02A771d515e077c9C2403a1ef324885CeC)
        ];
    }

    /// @inheritdoc CurveLevSwapper3Tokens
    function metapool() public pure override returns (IMetaPool3) {
        return IMetaPool3(0x445FE580eF8d70FF569aB36e80c647af338db351);
    }

    /// @inheritdoc CurveLevSwapper3Tokens
    function lpToken() public pure override returns (IERC20) {
        return IERC20(0xE7a24EF0C5e95Ffb0f6684b813A78F2a3AD7D171);
    }
}
