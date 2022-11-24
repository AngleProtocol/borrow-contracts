// SPDX-License-Identifier: MIT

pragma solidity ^0.8.12;

contract MockAnything {
    uint256 public stateVar = 1;

    error CustomError();
    error CustomErrorWithValue(uint256);

    function fail(uint256 value) external view returns (uint256) {
        stateVar;
        if (value < 10) {
            revert CustomError();
        }
        if (value < 20) {
            revert CustomErrorWithValue(value);
        }
        return value + 1;
    }

    function modifyState(uint256 value) external {
        stateVar = value;
    }
}
