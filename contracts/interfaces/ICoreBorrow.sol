// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.10;

interface ICoreBorrow {
    function isGovernorOrGuardian(address admin) external view returns (bool);

    function isGovernor(address admin) external view returns (bool);

    function isFlashLoanerTreasury(address treasury) external view returns (bool);
}
