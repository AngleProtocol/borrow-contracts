// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

/// @title IPerpetualManager
interface IPerpetualManager {
    function totalHedgeAmount() external view returns (uint256);
}
