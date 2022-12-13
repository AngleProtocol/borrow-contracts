// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

import "../../BaseOracleChainlinkMultiTwoFeeds.sol";

/// @title OracleAVAXEURChainlinkAvalanche
/// @author Angle Labs, Inc.
/// @notice Gives the price of AVAX in Euro in base 18
/// @dev This contract is built to be deployed on Avalanche
contract OracleAVAXEURChainlinkAvalanche is BaseOracleChainlinkMultiTwoFeeds {
    string public constant DESCRIPTION = "AVAX/EUR Oracle";

    constructor(uint32 _stalePeriod, address _treasury) BaseOracleChainlinkMultiTwoFeeds(_stalePeriod, _treasury) {}

    /// @inheritdoc BaseOracleChainlinkMultiTwoFeeds
    function circuitChainlink() public pure override returns (AggregatorV3Interface[2] memory) {
        return [
            // Oracle AVAX/USD
            AggregatorV3Interface(0x0A77230d17318075983913bC2145DB16C7366156),
            // Oracle EUR/USD
            AggregatorV3Interface(0x192f2DBA961Bb0277520C082d6bfa87D5961333E)
        ];
    }
}
