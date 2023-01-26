// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.17;

import "./Treasury.sol";

/// @title Treasury
/// @author Angle Labs, Inc.
/// @notice Immutable Treasury of Angle Borrowing Module
contract TreasuryImmutable is Treasury {
    // =============================== References ==================================
    // TODO update with final keccak256(VaultManagerImmutable bytecode)
    bytes32 private constant _VAULT_MANAGER_IMPL = hex"";

    // =============================== Errors ======================================

    error InvalidVaultManager();

    /// @param _core Address of the `CoreBorrow` contract of the module
    /// @param _stablecoin Address of the stablecoin
    constructor(ICoreBorrow _core, IAgToken _stablecoin) Treasury() {
        if (address(_stablecoin) == address(0) || address(_core) == address(0)) revert ZeroAddress();
        core = _core;
        stablecoin = _stablecoin;
    }

    /// @inheritdoc Treasury
    function addVaultManager(address vaultManager) external override onlyGovernor {
        if (vaultManagerMap[vaultManager] == 1) revert AlreadyVaultManager();
        if (keccak256(vaultManager.code) != _VAULT_MANAGER_IMPL) revert InvalidVaultManager();
        if (address(IVaultManager(vaultManager).treasury()) != address(this)) revert InvalidTreasury();
        vaultManagerMap[vaultManager] = 1;
        vaultManagerList.push(vaultManager);
        emit VaultManagerToggled(vaultManager);
        stablecoin.addMinter(vaultManager);
    }

    /// @inheritdoc Treasury
    function addMinter(address minter) external override {}

    /// @inheritdoc Treasury
    function removeMinter(address minter) external override {}

    /// @inheritdoc Treasury
    function setTreasury(address _treasury) external override {}
}
