// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

import "../interfaces/IBorrowStaker.sol";
import "./VaultManager.sol";

/// @title VaultManagerListing
/// @author Angle Core Team
/// @notice Provide an additional viewer to `VaumtManager` to get the full collateral deposited
/// by an owner
contract VaultManagerListing is VaultManager {
    using SafeERC20 for IERC20;
    using Address for address;

    // ================================== STORAGE ==================================

    // @notice Mapping from owner address to all his vaults
    mapping(address => uint256[]) internal _ownerListVaults;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(uint256 dust_, uint256 dustCollateral_) VaultManager(dust_, dustCollateral_) {}

    // =============================== VIEW FUNCTIONS ==============================

    /// @notice Get the collateral owned by the user in the vault manager
    /// @dev Protect against reentrancy for external contract reading first the value and then allow
    /// the caller to call functions reducing the collateral amount.
    /// Same protection needed as for `virtual_price` on Curve contracts
    function getUserVaults(address user) external nonReentrant returns (uint256[] memory) {
        return _ownerListVaults[user];
    }

    // ================= INTERNAL UTILITY STATE-MODIFYING FUNCTIONS ================

    /// @inheritdoc VaultManagerERC721
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 vaultID
    ) internal override {
        // if this is not a mint remove from the `from` vault list `vaultID`
        if (from != address(0)) _removeVaultFromList(from, vaultID);
        if (to != address(0)) _ownerListVaults[to].push(vaultID);
        // if it is a transfer checkpoint for both
        // we can also remove and let them do the checkpoint by hand
        if (from != address(0) && to != address(0)) {
            IBorrowStaker(address(collateral)).checkpoint(from);
            IBorrowStaker(address(collateral)).checkpoint(to);
        }
    }

    /// @inheritdoc VaultManager
    /// @dev Update the collateralAmount for the owner of the vault and checkpooint if necessary
    /// the `staker`rewards before getting liquidated
    function _checkpointLiquidate(
        uint256 vaultID,
        uint256,
        uint256,
        bool burn
    ) internal override {
        address owner = _ownerOf(vaultID);
        if (burn) _removeVaultFromList(owner, vaultID);
        IBorrowStaker(address(collateral)).checkpoint(owner);
    }

    /// @notice Remove `vaultID` from `user` stroed vault list
    /// @param user Address to look out for the vault list
    /// @param vaultID VaultId to remove from the list
    /// @dev The vault is necessarily in the list
    function _removeVaultFromList(address user, uint256 vaultID) internal {
        uint256[] storage vaultList = _ownerListVaults[user];
        uint256 vaultListLength = vaultList.length;
        for (uint256 i = 0; i < vaultListLength - 1; i++) {
            if (vaultList[i] == vaultID) {
                vaultList[i] = vaultList[vaultListLength - 1];
                break;
            }
        }
        vaultList.pop();
    }
}
