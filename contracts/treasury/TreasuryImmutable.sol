// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.17;

import "./Treasury.sol";

/// @title Treasury
/// @author Angle Labs, Inc.
/// @notice Immutable Treasury of Angle Borrowing Module
contract TreasuryImmutable is Treasury {
    // =============================== References ==================================
    bytes32 private constant _VAULT_MANAGER_IMPL =
        hex"8e3f1274ce9682d0f2b885883068df4322f29d1834b6ab26fc9a8e74a11bac73";

    // ======================= Parameters and Variables ============================
    uint8 private _isSetStablecoin;

    // =============================== Errors ======================================

    error AlreadySetStablecoin();
    error InvalidVaultManager();
    error InvalidStablecoin();

    /// @param _core Address of the `CoreBorrow` contract of the module
    constructor(ICoreBorrow _core) initializer {
        if (address(_core) == address(0)) revert ZeroAddress();
        core = _core;
    }

    /// @notice Can only be called once after by governance to link the `agToken` to the `treasury`
    /// @param _stablecoin Address of the stablecoin
    function setStablecoin(IAgToken _stablecoin) public onlyGovernor {
        if (_isSetStablecoin == type(uint8).max) revert AlreadySetStablecoin();
        if (address(_stablecoin) == address(0) || IAgToken(_stablecoin).treasury() != address(this))
            revert ZeroAddress();
        _isSetStablecoin = type(uint8).max;
        stablecoin = _stablecoin;
    }

    /// @inheritdoc Treasury
    function addVaultManager(address vaultManager) external override onlyGovernor {
        if (keccak256(vaultManager.code) != _vaultManagerImpl()) revert InvalidVaultManager();
        _addVaultManager(vaultManager);
    }

    /// @notice Get the vault manger implementation bytecode hash
    function _vaultManagerImpl() internal view virtual returns (bytes32) {
        return _VAULT_MANAGER_IMPL;
    }

    /// @inheritdoc Treasury
    function initialize(ICoreBorrow _core, IAgToken _stablecoin) public override {}

    /// @inheritdoc Treasury
    function addMinter(address minter) external override {}

    /// @inheritdoc Treasury
    function removeMinter(address minter) external override {}

    /// @inheritdoc Treasury
    function setTreasury(address _treasury) external override {}
}
