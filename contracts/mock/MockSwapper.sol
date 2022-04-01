// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../interfaces/ISwapper.sol";

contract MockSwapper is ISwapper {
    bytes32 public constant CALLBACK_SUCCESS = keccak256("ERC3156FlashBorrower.onFlashLoan");

    uint256 public counter;

    constructor() {}

    function swap(
        IERC20,
        IERC20,
        address,
        uint256,
        uint256,
        bytes calldata data
    ) external {
        counter += 1;
        data;
    }
}
