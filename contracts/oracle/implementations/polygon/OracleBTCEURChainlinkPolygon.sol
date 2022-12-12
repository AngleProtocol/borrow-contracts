// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

import "../../BaseOracleChainlinkMultiTwoFeeds.sol";

/// @title OracleBTCEURChainlinkPolygon
/// @author Angle Labs, Inc.
/// @notice Gives the price of BTC in Euro in base 18
/// @dev This contract is built to be deployed on Polygon
contract OracleBTCEURChainlinkPolygon is BaseOracleChainlinkMultiTwoFeeds {
    string public constant DESCRIPTION = "BTC/EUR Oracle";

    constructor(uint32 _stalePeriod, address _treasury) BaseOracleChainlinkMultiTwoFeeds(_stalePeriod, _treasury) {}

    /// @inheritdoc BaseOracleChainlinkMultiTwoFeeds
    function circuitChainlink() public pure override returns (AggregatorV3Interface[2] memory) {
        return [
            // Oracle ETH/USD
            AggregatorV3Interface(0xF9680D99D6C9589e2a93a78A04A279e509205945),
            // Oracle EUR/USD
            AggregatorV3Interface(0x73366Fe0AA0Ded304479862808e02506FE556a98)
        ];
    }
}
