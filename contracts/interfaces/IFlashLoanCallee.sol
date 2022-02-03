// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.10;

interface IFlashLoanCallee {
    function flashLoanCall(
        address stablecoinRecipient,
        uint256 stablecoinOwed,
        uint256 collateralObtained,
        bytes calldata data
    ) external;
}
