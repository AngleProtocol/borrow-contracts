// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

import "../../BaseOracleChainlinkMultiTwoFeeds.sol";

/// @title OracleETHEURChainlinkOptimism
/// @author Angle Labs, Inc.
/// @notice Gives the price of ETH in Euro in base 18
/// @dev This contract is built to be deployed on Optimism
contract OracleETHEURChainlinkOptimism is BaseOracleChainlinkMultiTwoFeeds {
    string public constant DESCRIPTION = "ETH/EUR Oracle";

    constructor(uint32 _stalePeriod, address _treasury) BaseOracleChainlinkMultiTwoFeeds(_stalePeriod, _treasury) {}

    /// @inheritdoc BaseOracleChainlinkMultiTwoFeeds
    function circuitChainlink() public pure override returns (AggregatorV3Interface[2] memory) {
        return [
            // Oracle ETH/USD
            AggregatorV3Interface(0x13e3Ee699D1909E989722E753853AE30b17e08c5),
            // Oracle EUR/USD
            AggregatorV3Interface(0x3626369857A10CcC6cc3A6e4f5C2f5984a519F20)
        ];
    }
}
