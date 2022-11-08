// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

import "./VaultManager.sol";

/// @title VaultManagerLiquidationBoost
/// @author Angle Core Team
/// @notice Liquidation discount depending also on the liquidator veANGLE balance
contract VaultManagerLiquidationBoost is VaultManager {
    using SafeERC20 for IERC20;
    using Address for address;

    // ================================== STORAGE ==================================

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(uint256 dust_, uint256 dustCollateral_) VaultManager(dust_, dustCollateral_) {}

    // ================= INTERNAL UTILITY STATE-MODIFYING FUNCTIONS ================

    /// @notice Computes the liquidation boost of a given address, that is the slope of the discount function
    /// @param liquidator Address for which boost should be computed
    /// @return The slope of the discount function
    function _computeLiquidationBoost(address liquidator) internal view override returns (uint256) {
        if (address(veBoostProxy) == address(0)) {
            return yLiquidationBoost[0];
        } else {
            uint256 adjustedBalance = veBoostProxy.adjusted_balance_of(liquidator);
            if (adjustedBalance >= xLiquidationBoost[1]) return yLiquidationBoost[1];
            else if (adjustedBalance <= xLiquidationBoost[0]) return yLiquidationBoost[0];
            else
                return
                    yLiquidationBoost[0] +
                    ((yLiquidationBoost[1] - yLiquidationBoost[0]) * (adjustedBalance - xLiquidationBoost[0])) /
                    (xLiquidationBoost[1] - xLiquidationBoost[0]);
        }
    }
}
