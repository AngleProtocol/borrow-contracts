// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

//solhint-disable
interface AToken {
    function mint(
        address user,
        // address onBehalfOf,
        uint256 amount,
        uint256 index
    ) external returns (bool);
}
