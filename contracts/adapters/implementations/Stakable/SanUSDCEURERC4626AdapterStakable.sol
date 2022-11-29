// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.12;

import "../../SanTokenERC4626AdapterStakable.sol";

/// @title SanUSDCEURERC4626AdapterStakable
/// @author Angle Labs, Inc.
/// @notice IERC4626 Adapter for SanTokens of the Angle Protocol
/// @dev USDC stakable implementation
contract SanUSDCEURERC4626AdapterStakable is SanTokenERC4626AdapterStakable {
    /// @inheritdoc SanTokenERC4626Adapter
    function stableMaster() public pure override returns (IStableMaster) {
        return IStableMaster(0x5adDc89785D75C86aB939E9e15bfBBb7Fc086A87);
    }

    /// @inheritdoc SanTokenERC4626Adapter
    function poolManager() public pure override returns (address) {
        return 0xe9f183FC656656f1F17af1F2b0dF79b8fF9ad8eD;
    }

    /// @inheritdoc SanTokenERC4626Adapter
    function sanToken() public pure override returns (IERC20MetadataUpgradeable) {
        return IERC20MetadataUpgradeable(0x9C215206Da4bf108aE5aEEf9dA7caD3352A36Dad);
    }

    /// @inheritdoc SanTokenERC4626Adapter
    function asset() public pure override returns (address) {
        return 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    }

    /// @inheritdoc SanTokenERC4626Adapter
    function gauge() public pure override returns (ILiquidityGauge) {
        return ILiquidityGauge(0x51fE22abAF4a26631b2913E417c0560D547797a7);
    }
}
