// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.17;

import "../treasury/TreasuryImmutable.sol";

/// @title Treasury
/// @author Angle Labs, Inc.
/// @notice Mock Immutable Treasury of Angle Borrowing Module
contract MockTreasuryImmutable is TreasuryImmutable {
    bytes32 private _MOCK_VAULT_MANAGER_IMPLEMENTATION;

    /// @param _core Address of the `CoreBorrow` contract of the module
    /// @param _stablecoin Address of the stablecoin
    constructor(ICoreBorrow _core, IAgToken _stablecoin) TreasuryImmutable(_core, _stablecoin) {}

    /// @notice Get the vault manger implementation bytecode hash
    function _vaultManagerImpl() internal view override returns (bytes32) {
        return _MOCK_VAULT_MANAGER_IMPLEMENTATION;
    }

    /// @notice Get the vault manger implementation bytecode hash
    function setVaultManagerImpl(bytes32 _newImplemetation) external {
        _MOCK_VAULT_MANAGER_IMPLEMENTATION = _newImplemetation;
    }
}
