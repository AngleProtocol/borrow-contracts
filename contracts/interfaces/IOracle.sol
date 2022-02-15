// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.10;

import "./ITreasury.sol";

interface IOracle {
    /// @notice Reads the rate from the Chainlink circuit
    /// @return quoteAmount The current rate between the in-currency and out-currency
    function read() external view returns (uint256);

    /// @notice Changes the treasury contract
    /// @param _treasury Address of the new treasury contract
    /// @dev This function can only be called by an approved `vaultManager` contract which can call
    /// this function after being requested to do so by a `treasury` contract
    function setTreasury(address _treasury) external;

    /// @notice Reference to the `treasury` contract handling this `VaultManager`
    function treasury() external view returns (ITreasury);
}
