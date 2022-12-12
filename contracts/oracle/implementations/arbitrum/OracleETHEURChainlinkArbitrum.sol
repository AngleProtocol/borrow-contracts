// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

import "../../BaseOracleChainlinkMultiTwoFeeds.sol";

/// @title OracleETHEURChainlinkArbitrum
/// @author Angle Labs, Inc.
/// @notice Gives the price of ETH in Euro in base 18
/// @dev This contract is built to be deployed on Arbitrum
contract OracleETHEURChainlinkArbitrum is BaseOracleChainlinkMultiTwoFeeds {
    string public constant DESCRIPTION = "ETH/EUR Oracle";

    constructor(uint32 _stalePeriod, address _treasury) BaseOracleChainlinkMultiTwoFeeds(_stalePeriod, _treasury) {}

    /// @inheritdoc BaseOracleChainlinkMultiTwoFeeds
    function circuitChainlink() public pure override returns (AggregatorV3Interface[2] memory) {
        return [
            // Oracle ETH/USD
            AggregatorV3Interface(0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612),
            // Oracle EUR/USD
            AggregatorV3Interface(0xA14d53bC1F1c0F31B4aA3BD109344E5009051a84)
        ];
    }
}
