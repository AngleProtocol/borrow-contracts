// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.12;

import "../swapper/LevSwapper/angle/implementations/mainnet/SanUSDCEURLevSwapper.sol";

/// @author Angle Labs, Inc
/// @notice Template leverage swapper on sanTokens
contract MockSanTokenLevSwapper is SanUSDCEURLevSwapper {
    IBorrowStaker internal _angleStaker;

    constructor(
        ICoreBorrow _core,
        IUniswapV3Router _uniV3Router,
        address _oneInch,
        IAngleRouterSidechain _angleRouter,
        IBorrowStaker angleStaker_
    ) SanUSDCEURLevSwapper(_core, _uniV3Router, _oneInch, _angleRouter) {
        _angleStaker = angleStaker_;
    }

    /// @inheritdoc BaseLevSwapper
    function angleStaker() public view override returns (IBorrowStaker) {
        return _angleStaker;
    }

    function setAngleStaker(IBorrowStaker angleStaker_) public {
        _angleStaker = angleStaker_;
    }
}
