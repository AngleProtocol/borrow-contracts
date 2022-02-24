// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

/// @title IStableMaster
/// @author Angle Core Team
/// @notice Interface for the `StableMaster` contract
/// @dev This interface only contains functions of the `StableMaster` contract which are called by other contracts
/// of this module
interface IStableMaster {
    function updateStocksUsers(uint256 amount, address poolManager) external;
}
