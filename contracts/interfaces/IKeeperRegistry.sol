// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";

/// @title IKeeperRegistry
/// @author Angle Labs, Inc
interface IKeeperRegistry {
    /// @notice Checks whether an address is whitelisted during oracle updates
    /// @param caller Address for which the whitelist should be checked
    /// @return Whether the address is trusted or not
    function isTrusted(address caller) external view returns (bool);
}
