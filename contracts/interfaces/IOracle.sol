// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.10;

interface IOracle {
    function read() external view returns(uint256);
}
