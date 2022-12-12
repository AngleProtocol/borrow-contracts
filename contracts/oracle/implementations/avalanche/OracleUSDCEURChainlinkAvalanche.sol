// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

import "../../BaseOracleChainlinkMultiTwoFeeds.sol";

/// @title OracleUSDCEURChainlinkAvalanche
/// @author Angle Labs, Inc.
/// @notice Gives the price of USDC in Euro in base 18
/// @dev This contract is built to be deployed on Avalanche
contract OracleUSDCEURChainlinkAvalanche is BaseOracleChainlinkMultiTwoFeeds {
    string public constant DESCRIPTION = "USDC/EUR Oracle";

    constructor(uint32 _stalePeriod, address _treasury) BaseOracleChainlinkMultiTwoFeeds(_stalePeriod, _treasury) {}

    /// @inheritdoc BaseOracleChainlinkMultiTwoFeeds
    function circuitChainlink() public pure override returns (AggregatorV3Interface[2] memory) {
        return [
            // Oracle USDC/USD
            AggregatorV3Interface(0xF096872672F44d6EBA71458D74fe67F9a77a23B9),
            // Oracle EUR/USD
            AggregatorV3Interface(0x192f2DBA961Bb0277520C082d6bfa87D5961333E)
        ];
    }
}
