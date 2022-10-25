// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.12;

import "../swapper/LevSwapper/angle/SanTokenLevSwapper.sol";

/// @author Angle Core Team
/// @notice Template leverage swapper on sanTokens
contract SanTokenLevSwapperTemplate is SanTokenLevSwapper {
    IBorrowStaker internal _angleStaker;

    constructor(
        ICoreBorrow _core,
        IUniswapV3Router _uniV3Router,
        address _oneInch,
        IAngleRouterSidechain _angleRouter,
        IBorrowStaker angleStaker_
    ) SanTokenLevSwapper(_core, _uniV3Router, _oneInch, _angleRouter) {
        _angleStaker = angleStaker_;
    }

    /// @inheritdoc BaseLevSwapper
    function angleStaker() public view override returns (IBorrowStaker) {
        return _angleStaker;
    }

    /// @inheritdoc SanTokenLevSwapper
    function stableMaster() public pure override returns (IStableMaster) {
        return IStableMaster(0x5adDc89785D75C86aB939E9e15bfBBb7Fc086A87);
    }

    /// @inheritdoc SanTokenLevSwapper
    function poolManager() public pure override returns (address) {
        return 0xe9f183FC656656f1F17af1F2b0dF79b8fF9ad8eD;
    }

    /// @inheritdoc SanTokenLevSwapper
    function collateral() public pure override returns (IERC20) {
        return IERC20(0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48);
    }

    /// @inheritdoc SanTokenLevSwapper
    function sanToken() public pure override returns (IERC20) {
        return IERC20(0x9C215206Da4bf108aE5aEEf9dA7caD3352A36Dad);
    }

    function setAngleStaker(IBorrowStaker angleStaker_) public {
        _angleStaker = angleStaker_;
    }
}
