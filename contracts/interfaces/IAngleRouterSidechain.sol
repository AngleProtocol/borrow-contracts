// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

/// @title IAngleRouterSidechain
/// @author Angle Core Team
/// @notice Interface for the `AngleRouter` contract on other chains
interface IAngleRouterSidechain {
    function mixer(
        uint128[] memory paramsPermit,
        uint128[] memory actions,
        bytes[] calldata data
    ) external;
}
