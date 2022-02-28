// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.7;

import "../interfaces/IRepayCallee.sol";

contract MockRepayCallee is IRepayCallee {
    bytes32 public constant CALLBACK_SUCCESS = keccak256("ERC3156FlashBorrower.onFlashLoan");

    uint256 public counter;

    constructor() {}

    function repayCallStablecoin(
        address,
        uint256,
        uint256,
        bytes calldata data
    ) external {
        counter += 1;
        data;
    }

    function repayCallCollateral(
        address,
        uint256,
        uint256,
        bytes calldata data
    ) external {
        counter += 1;
        data;
    }
}
