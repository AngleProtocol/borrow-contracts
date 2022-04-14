// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

/// @title IPoolManager
/// @author Angle Core Team
/// @notice Previous interface with additionnal getters for public variables and mappings
/// @dev Used in other contracts of the protocol
interface IPoolManager {
    function token() external view returns (address);
}