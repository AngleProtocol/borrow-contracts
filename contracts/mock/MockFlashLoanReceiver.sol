// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.7;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import "@openzeppelin/contracts/interfaces/IERC3156FlashBorrower.sol";

contract MockFlashLoanReceiver is IERC3156FlashBorrower {
    bytes32 public constant CALLBACK_SUCCESS = keccak256("ERC3156FlashBorrower.onFlashLoan");

    constructor() {}

    function onFlashLoan(
        address,
        address token,
        uint256 amount,
        uint256 fee,
        bytes calldata
    ) external override returns (bytes32) {
        IERC20(token).approve(msg.sender, amount+fee);
        if (amount >= 10**30) return keccak256("error");
        else return CALLBACK_SUCCESS;
    }

}
