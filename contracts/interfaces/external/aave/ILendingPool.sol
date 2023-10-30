// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

//solhint-disable
interface ILendingPool {
    function deposit(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
}
