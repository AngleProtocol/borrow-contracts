// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.10;

import "./ITreasury.sol";

interface IVaultManager {
    /// @notice Reference to the `treasury` contract handling this `VaultManager`
    function treasury() external view returns (ITreasury);

    function getDebtOut(
        uint256 vaultID,
        uint256 amountStablecoins,
        uint256 senderBorrowFee
    ) external;

    /// @notice Accrues interest accumulated across all vaults to the surplus and sends the surplus to the treasury
    /// @return surplusValue Value of the surplus communicated to the `Treasury`
    /// @return badDebtValue Value of the bad debt communicated to the `Treasury`
    /// @dev `surplus` and `badDebt` should be reset to 0 once their current value have been given to the `treasury` contract
    function accrueInterestToTreasury() external returns (uint256 surplusValue, uint256 badDebtValue);

    function setTreasury(address _newTreasury) external;
}
