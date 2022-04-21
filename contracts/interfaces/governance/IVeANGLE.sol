// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

/// @title IVeANGLE
/// @author Angle Core Team
/// @notice Interface for the `VeANGLE` contract
interface IVeANGLE {
    // solhint-disable-next-line func-name-mixedcase
    function deposit_for(address addr, uint256 amount) external;
}
