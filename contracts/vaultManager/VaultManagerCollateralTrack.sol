// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

import "./VaultManager.sol";

/// @title VaultManagerCollateralTrack
/// @author Angle Core Team
/// @notice Provide an additional viewer to `VaumtManager` to get the full collateral deposited
/// by an owner
contract VaultManagerCollateralTrack is VaultManager {
    using SafeERC20 for IERC20;
    using Address for address;

    // ================================== STORAGE ==================================

    // Mapping from owner address to the sum of all collateral owned accross all vaults
    mapping(address => uint256) internal _collateralBalances;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(uint256 dust_, uint256 dustCollateral_) VaultManager(dust_, dustCollateral_) {}

    // =============================== VIEW FUNCTIONS ==============================

    /// @notice Get the collateral owned by the user in the vault manager
    /// @dev Protect against reentrancy for external contract reading first the value and then allow
    /// the caller to call functions reducing the collateral amount.
    /// Same protection needed as for `virtual_price` on Curve contracts
    function getUserCollateral(address user) external nonReentrant returns (uint256) {
        return _collateralBalances[user];
    }

    // ================= INTERNAL UTILITY STATE-MODIFYING FUNCTIONS ================

    /// @inheritdoc VaultManager
    function _addCollateral(uint256 vaultID, uint256 collateralAmount) internal override {
        if (!_exists(vaultID)) revert NonexistentVault();
        vaultData[vaultID].collateralAmount += collateralAmount;
        _collateralBalances[_ownerOf(vaultID)] += collateralAmount;
        emit CollateralAmountUpdated(vaultID, collateralAmount, 1);
    }

    /// @inheritdoc VaultManager
    function _removeCollateral(
        uint256 vaultID,
        uint256 collateralAmount,
        uint256 oracleValue,
        uint256 interestAccumulator_
    ) internal override onlyApprovedOrOwner(msg.sender, vaultID) {
        vaultData[vaultID].collateralAmount -= collateralAmount;
        _collateralBalances[_ownerOf(vaultID)] -= collateralAmount;
        (uint256 healthFactor, , ) = _isSolvent(vaultData[vaultID], oracleValue, interestAccumulator_);
        if (healthFactor <= BASE_PARAMS) revert InsolventVault();
        emit CollateralAmountUpdated(vaultID, collateralAmount, 0);
    }
}