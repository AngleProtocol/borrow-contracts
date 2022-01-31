// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.10;

interface IStableMaster {
    function updateStocksUsers(uint256 amount, address poolManager) external;
}
