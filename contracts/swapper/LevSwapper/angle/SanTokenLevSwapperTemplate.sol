// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.12;

import "./SanTokenLevSwapper.sol";

/// @author Angle Labs, Inc
/// @notice Template leverage swapper on sanTokens
contract SanTokenLevSwapperTemplate is SanTokenLevSwapper {
    constructor(
        ICoreBorrow _core,
        IUniswapV3Router _uniV3Router,
        address _oneInch,
        IAngleRouterSidechain _angleRouter
    ) SanTokenLevSwapper(_core, _uniV3Router, _oneInch, _angleRouter) {}

    /// @inheritdoc BaseLevSwapper
    function angleStaker() public pure override returns (IBorrowStaker) {
        return IBorrowStaker(address(0));
    }

    /// @inheritdoc SanTokenLevSwapper
    function stableMaster() public pure override returns (IStableMaster) {
        return IStableMaster(address(0));
    }

    /// @inheritdoc SanTokenLevSwapper
    function poolManager() public pure override returns (address) {
        return address(0);
    }

    /// @inheritdoc SanTokenLevSwapper
    function collateral() public pure override returns (IERC20) {
        return IERC20(address(0));
    }

    /// @inheritdoc SanTokenLevSwapper
    function sanToken() public pure override returns (IERC20) {
        return IERC20(address(0));
    }
}
