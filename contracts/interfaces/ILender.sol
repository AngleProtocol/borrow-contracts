// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

/// @title ILender
/// @author Angle Labs, Inc.
interface ILender {
    function distribute(uint256 amountForGovernance, uint256 totalAmount) external;

    function pull(uint256 amount, address to) external;

    function push(uint256 amount) external;
}
