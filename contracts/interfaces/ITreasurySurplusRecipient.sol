// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.10;

interface ITreasurySurplusRecipient {
    function accrueInterestToTreasury() external returns (uint256 balance);
}
