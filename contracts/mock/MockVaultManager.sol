// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.10;

import "../interfaces/IVaultManager.sol";
import "../interfaces/ITreasury.sol";

contract MockVaultManager is IVaultManager {
    ITreasury public override treasury;

    constructor (address _treasury) {
        treasury = ITreasury(_treasury);
    }


    function accrueInterestToTreasury() external override returns (uint256, uint256) {

    }

    function getDebtOut(
        uint256 vaultID,
        uint256 amountStablecoins,
        uint256 senderBorrowFee
    ) external override {

    }

    function setTreasury(address _treasury) external override {

    }

}
