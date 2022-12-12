// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

import "../../BaseOracleChainlinkMultiTwoFeeds.sol";

/// @title OracleLUSDEURChainlink
/// @author Angle Labs, Inc.
/// @notice Gives the price of LUSD in Euro in base 18
contract OracleLUSDEURChainlink is BaseOracleChainlinkMultiTwoFeeds {
    string public constant DESCRIPTION = "LUSD/EUR Oracle";

    constructor(uint32 _stalePeriod, address _treasury) BaseOracleChainlinkMultiTwoFeeds(_stalePeriod, _treasury) {}

    /// @inheritdoc BaseOracleChainlinkMultiTwoFeeds
    function circuitChainlink() public pure override returns (AggregatorV3Interface[2] memory) {
        return [
            // Oracle LUSD/USD
            AggregatorV3Interface(0x3D7aE7E594f2f2091Ad8798313450130d0Aba3a0),
            // Oracle EUR/USD
            AggregatorV3Interface(0xb49f677943BC038e9857d61E7d053CaA2C1734C1)
        ];
    }
}
