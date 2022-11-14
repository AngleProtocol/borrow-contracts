// SPDX-License-Identifier: GPL-3.0

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "../interfaces/IVaultManager.sol";

pragma solidity 0.8.12;

/// @title AngleBorrowHelpers
/// @author Angle Labs, Inc.
/// @notice Contract with view functions designed to facilitate integrations on the Borrow module of the Angle Protocol
/// @dev This contract only contains view functions to be queried off-chain. It was thus not optimized for gas consumption
contract AngleBorrowHelpers is Initializable {
    /// @notice Returns all the vaults owned or controlled (under the form of approval) by an address
    /// @param vaultManager VaultManager address to query vaultIDs on
    /// @param spender Address for which vault ownerships should be checked
    /// @return List of `vaultID` controlled by this address
    /// @return Count of vaults owned by the address
    /// @dev This function is never to be called on-chain since it iterates over all vaultIDs. It is here
    /// to reduce dependency on an external graph to link an ID to its owner
    function getControlledVaults(IVaultManager vaultManager, address spender)
        external
        view
        returns (uint256[] memory, uint256)
    {
        uint256 arraySize = vaultManager.vaultIDCount();
        uint256[] memory vaultsControlled = new uint256[](arraySize);
        uint256 count;
        for (uint256 i = 1; i <= arraySize; i++) {
            try vaultManager.isApprovedOrOwner(spender, i) returns (bool _isApprovedOrOwner) {
                if (_isApprovedOrOwner) {
                    vaultsControlled[count] = i;
                    count += 1;
                }
            } catch {
                continue;
            } // This happens if nobody owns the vaultID=i (if there has been a burn)
        }
        return (vaultsControlled, count);
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() initializer {}
}
