// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

import "../../BaseOracleChainlinkMultiTwoFeeds.sol";

/// @title OracleETHEURChainlink
/// @author Angle Labs, Inc.
/// @notice Gives the price of ETH in Euro in base 18
contract OracleETHEURChainlink is BaseOracleChainlinkMultiTwoFeeds {
    string public constant DESCRIPTION = "ETH/EUR Oracle";

    constructor(uint32 _stalePeriod, address _treasury) BaseOracleChainlinkMultiTwoFeeds(_stalePeriod, _treasury) {}

    /// @inheritdoc BaseOracleChainlinkMultiTwoFeeds
    function circuitChainlink() public pure override returns (AggregatorV3Interface[2] memory) {
        return [
            // Oracle ETH/USD
            AggregatorV3Interface(0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419),
            // Oracle EUR/USD
            AggregatorV3Interface(0xb49f677943BC038e9857d61E7d053CaA2C1734C1)
        ];
    }
}
