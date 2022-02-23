// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.10;

import "../interfaces/IVaultManager.sol";
import "../interfaces/ITreasury.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockVaultManager is IVaultManagerFunctions, IVaultManagerStorage {
    ITreasury public override treasury;
    uint256 public surplus;
    uint256 public badDebt;
    IAgToken public token;

    constructor(address _treasury) {
        treasury = ITreasury(_treasury);
    }

    function accrueInterestToTreasury() external override returns (uint256, uint256) {
        // Avoid the function to be view
        if (surplus >= badDebt) {
            token.mint(msg.sender, surplus - badDebt);
        }
        return (surplus, badDebt);
    }

    function setSurplusBadDebt(
        uint256 _surplus,
        uint256 _badDebt,
        IAgToken _token
    ) external {
        surplus = _surplus;
        badDebt = _badDebt;
        token = _token;
    }

    function getDebtOut(
        uint256 vaultID,
        uint256 amountStablecoins,
        uint256 senderBorrowFee
    ) external override {}

    function setTreasury(address _treasury) external override {
        treasury = ITreasury(_treasury);
    }
}
