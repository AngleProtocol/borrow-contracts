// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.12;

import "../../SanTokenERC4626AdapterStakable.sol";

/// @title SanFRAXEURERC4626AdapterStakable
/// @author Angle Labs, Inc.
/// @notice IERC4626 Adapter for SanTokens of the Angle Protocol
/// @dev FRAX stakable implementation
contract SanFRAXEURERC4626AdapterStakable is SanTokenERC4626AdapterStakable {
    /// @inheritdoc SanTokenERC4626Adapter
    function stableMaster() public pure override returns (IStableMaster) {
        return IStableMaster(0x5adDc89785D75C86aB939E9e15bfBBb7Fc086A87);
    }

    /// @inheritdoc SanTokenERC4626Adapter
    function poolManager() public pure override returns (address) {
        return 0x6b4eE7352406707003bC6f6b96595FD35925af48;
    }

    /// @inheritdoc SanTokenERC4626Adapter
    function sanToken() public pure override returns (IERC20MetadataUpgradeable) {
        return IERC20MetadataUpgradeable(0xb3B209Bb213A5Da5B947C56f2C770b3E1015f1FE);
    }

    /// @inheritdoc SanTokenERC4626Adapter
    function asset() public pure override returns (address) {
        return 0x853d955aCEf822Db058eb8505911ED77F175b99e;
    }

    /// @inheritdoc SanTokenERC4626Adapter
    function gauge() public pure override returns (ILiquidityGauge) {
        return ILiquidityGauge(0xb40432243E4F317cE287398e72Ab8f0312fc2FE8);
    }
}
