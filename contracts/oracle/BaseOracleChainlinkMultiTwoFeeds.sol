// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

import "./BaseOracleChainlinkMulti.sol";

/// @title BaseOracleChainlinkMultiTwoFeeds
/// @author Angle Labs, Inc.
/// @notice Base contract for an oracle that reads into two Chainlink feeds (including an EUR/USD feed) which both have
/// 8 decimals
abstract contract BaseOracleChainlinkMultiTwoFeeds is BaseOracleChainlinkMulti {
    constructor(uint32 _stalePeriod, address _treasury) BaseOracleChainlinkMulti(_stalePeriod, _treasury) {}

    /// @notice Array with the list of Chainlink feeds in the order in which they are read
    function circuitChainlink() public pure virtual returns (AggregatorV3Interface[2] memory);

    /// @notice Returns the quote amount of the oracle contract
    function _getQuoteAmount() internal view virtual returns (uint256) {
        return 10**18;
    }

    /// @inheritdoc IOracle
    function read() external view override returns (uint256 quoteAmount) {
        quoteAmount = _getQuoteAmount();
        AggregatorV3Interface[2] memory _circuitChainlink = circuitChainlink();
        uint8[2] memory circuitChainIsMultiplied = [1, 0];
        uint8[2] memory chainlinkDecimals = [8, 8];
        for (uint256 i; i < 2; ++i) {
            quoteAmount = _readChainlinkFeed(
                quoteAmount,
                _circuitChainlink[i],
                circuitChainIsMultiplied[i],
                chainlinkDecimals[i]
            );
        }
    }
}
