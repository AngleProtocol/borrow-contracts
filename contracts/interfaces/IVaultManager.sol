// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.10;

interface IVaultManager {
    function getDebtOut(uint256 vaultID, uint256 amountStablecoins) external;

    function accrueInterestToTreasury() external returns (uint256 surplusCurrentValue, uint256 badDebtEndValue);
}
