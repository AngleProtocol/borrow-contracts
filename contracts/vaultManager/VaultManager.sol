// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.10;

import "./BaseVaultManager.sol";

/// @title VaultManager
/// @author Angle Core Team
/// @notice One VaultManager implementation of Angle Borrowing Module accounting for a non-rebasing ERC20
// TODO do we still keep
contract VaultManager is BaseVaultManager {
    /// @custom:oz-upgrades-unsafe-allow constructor
    // TODO check if still needed with new version of OpenZeppelin initializable contract
    constructor() initializer {}

    function _getCollateralInternalValue(uint256 collateralAmount) internal view override returns (uint256) {
        return collateralAmount;
    }

    function _getCollateralAmount(uint256 collateralInternalValue) internal view override returns (uint256) {
        return collateralInternalValue;
    }
}
