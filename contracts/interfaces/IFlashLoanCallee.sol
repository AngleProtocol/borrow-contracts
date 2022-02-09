// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.10;

interface IFlashLoanCallee {
    function flashLoanCallStablecoin(
        address stablecoinRecipient,
        uint256 stablecoinOwed,
        uint256 collateralObtained,
        bytes calldata data
    ) external;

    function flashLoanCallCollateral(
        address collateralRecipient,
        uint256 stablecoinPayment,
        uint256 collateralPayment,
        bytes calldata data
    ) external;
}
