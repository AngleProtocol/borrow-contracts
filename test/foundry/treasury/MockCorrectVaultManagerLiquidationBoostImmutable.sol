// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.17;

import "../../../contracts/vaultManager/VaultManagerLiquidationBoostImmutable.sol";

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
