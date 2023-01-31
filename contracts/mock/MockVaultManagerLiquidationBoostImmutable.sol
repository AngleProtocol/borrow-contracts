// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.17;

import "../vaultManager/VaultManagerLiquidationBoostImmutable.sol";

/// @title MockCorrectVaultManagerLiquidationBoostImmutable
/// @author Angle Labs, Inc.
/// @notice Mock VaultManagerLiquidationBoostImmutable with slightly different constructor
contract MockCorrectVaultManagerLiquidationBoostImmutable is VaultManagerLiquidationBoostImmutable {
    constructor(
        ITreasury _treasury,
        IERC20 _collateral,
        IOracle _oracle,
        VaultParameters memory params,
        string memory _symbol
    ) VaultManagerLiquidationBoostImmutable(_treasury, _collateral, _oracle, params, _symbol) initializer {}
}

/// @title MockIncorrectVaultManagerLiquidationBoostImmutable
/// @author Angle Labs, Inc.
/// @notice Mock VaultManagerLiquidationBoostImmutable with slightly different implementation
contract MockIncorrectVaultManagerLiquidationBoostImmutable is VaultManagerLiquidationBoostImmutable {
    constructor(
        ITreasury _treasury,
        IERC20 _collateral,
        IOracle _oracle,
        VaultParameters memory params,
        string memory _symbol
    ) VaultManagerLiquidationBoostImmutable(_treasury, _collateral, _oracle, params, _symbol) initializer {}

    /// @inheritdoc VaultManagerERC721
    /// @dev this is the function changed
    function _whitelistingActivated() internal pure override returns (bool) {
        return true;
    }
}
