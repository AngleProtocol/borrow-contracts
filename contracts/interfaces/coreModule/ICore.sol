// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

/// @title ICore
/// @author Angle Labs, Inc.
interface ICore {
    function stablecoinList() external view returns (address[] memory);
}
