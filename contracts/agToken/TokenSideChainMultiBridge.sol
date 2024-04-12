// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

import "./AgTokenSideChainMultiBridge.sol";

/// @title TokenSideChainMultiBridge
/// @author Angle Labs, Inc.
/// @notice Contract for ANGLE on other chains than Ethereum mainnet
/// @dev This contract supports bridge tokens having a minting right on the stablecoin (also referred to as the canonical
/// or the native token)
contract TokenSideChainMultiBridge is AgTokenSideChainMultiBridge {
    function setTreasury(_treasury) external override onlyGovernor {
        treasury = _treasury;
        emit TreasuryUpdated(_treasury);
    }
}
