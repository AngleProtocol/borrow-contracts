// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.10;

import "./ITreasury.sol";

interface IVaultManager {
    function treasury() external view returns (ITreasury);

    function getDebtOut(
        uint256 vaultID,
        uint256 amountStablecoins,
        uint256 senderBorrowFee
    ) external;

    function accrueInterestToTreasury() external returns (uint256 surplusCurrentValue, uint256 badDebtEndValue);

    function setTreasury(address _newTreasury) external;
}
