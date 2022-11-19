// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

/// @title IInterestRateModel
/// @author Angle Labs, Inc.
interface IInterestRateModel {
    function computeInterestRate(uint256 utilization) external view returns (uint256);
}
