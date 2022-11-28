// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.12;

import "../SanTokenERC4626Adapter.sol";

/// @title SanDAIEURERC4626AdapterStakable
/// @author Angle Labs, Inc.
/// @notice IERC4626 Adapter for SanTokens of the Angle Protocol
/// @dev DAI Implementation
contract SanDAIEURERC4626Adapter is SanTokenERC4626Adapter {
    /// @inheritdoc SanTokenERC4626Adapter
    function stableMaster() public pure override returns (IStableMaster) {
        return IStableMaster(0x5adDc89785D75C86aB939E9e15bfBBb7Fc086A87);
    }

    /// @inheritdoc SanTokenERC4626Adapter
    function poolManager() public pure override returns (address) {
        return 0xc9daabC677F3d1301006e723bD21C60be57a5915;
    }

    /// @inheritdoc SanTokenERC4626Adapter
    function sanToken() public pure override returns (IERC20MetadataUpgradeable) {
        return IERC20MetadataUpgradeable(0x7B8E89b0cE7BAC2cfEC92A371Da899eA8CBdb450);
    }

    /// @inheritdoc SanTokenERC4626Adapter
    function asset() public pure override returns (address) {
        return 0x6B175474E89094C44Da98b954EedeAC495271d0F;
    }
}
