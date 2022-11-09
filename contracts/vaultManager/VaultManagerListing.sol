// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

import { IBorrowStakerCheckpoint } from "../interfaces/IBorrowStaker.sol";
import "./VaultManager.sol";

/// @title VaultManagerListing
/// @author Angle Core Team
/// @notice Provides an additional viewer to `VaultManager` to get the full collateral deposited
/// by an owner
contract VaultManagerListing is VaultManager {
    using SafeERC20 for IERC20;
    using Address for address;

    // ================================== STORAGE ==================================

    // @notice Mapping from owner address to all his vaults
    mapping(address => uint256[]) internal _ownerListVaults;

    uint256[49] private __gapListing;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(uint256 dust_, uint256 dustCollateral_) VaultManager(dust_, dustCollateral_) {}

    // =============================== VIEW FUNCTIONS ==============================

    /// @notice Get the collateral owned by the user in the contract
    function getUserCollateral(address user) external view returns (uint256 totalCollateral) {
        uint256[] memory vaultList = _ownerListVaults[user];
        uint256 vaultListLength = vaultList.length;
        for (uint256 k; k < vaultListLength; k++) {
            totalCollateral += vaultData[vaultList[k]].collateralAmount;
        }
        return totalCollateral;
    }

    // ============================ OVERRIDEN FUNCTIONS ============================

    /// @inheritdoc VaultManager
    function _getDust() internal view override returns (uint256) {
        return dustOverride;
    }

    /// @inheritdoc VaultManager
    function _getDustCollateral() internal view override returns (uint256) {
        return _dustCollateralOverride;
    }

    // ================= INTERNAL UTILITY STATE-MODIFYING FUNCTIONS ================

    /// @inheritdoc VaultManagerERC721
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 vaultID
    ) internal override {
        // if this is not a mint remove from the `from` vault list `vaultID`
        if (from != address(0)) {
            _checkpointWrapper(from);
            _removeVaultFromList(from, vaultID);
        }
        if (to != address(0)) {
            _checkpointWrapper(to);
            _ownerListVaults[to].push(vaultID);
        }
    }

    /// @inheritdoc VaultManager
    /// @dev Checkpoints the staker associated to the `collateral` of the contract after an update of the
    /// `collateralAmount` of vaultID
    function _checkpointCollateral(uint256 vaultID, bool burn) internal override {
        address owner = _ownerOf(vaultID);
        _checkpointWrapper(owner);
        if (burn) _removeVaultFromList(owner, vaultID);
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

    /// @notice Checkpoint rewards for `user` in the `staker` contract
    /// @param user Address to look out for the vault list
    /// @dev Whenever there is an internal transfer or a transfer from the `vaultManager`,
    /// we need to update the rewards to correctly track everyone's claim
    function _checkpointWrapper(address user) internal {
        IBorrowStakerCheckpoint(address(collateral)).checkpoint(user);
    }
}
