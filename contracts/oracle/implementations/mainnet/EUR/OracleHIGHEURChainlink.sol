// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

import "../../../BaseOracleChainlinkMultiTwoFeeds.sol";

/// @title OracleHIGHEURChainlink
/// @author Angle Labs, Inc.
/// @notice Gives the price of HIGH in Euro in base 18
contract OracleHIGHEURChainlink is BaseOracleChainlinkMultiTwoFeeds {
    string public constant DESCRIPTION = "HIGH/EUR Oracle";

    constructor(uint32 _stalePeriod, address _treasury) BaseOracleChainlinkMultiTwoFeeds(_stalePeriod, _treasury) {}

    /// @inheritdoc IOracle
    function circuitChainlink() public pure override returns (AggregatorV3Interface[] memory) {
        AggregatorV3Interface[] memory _circuitChainlink = new AggregatorV3Interface[](1);
        // Oracle HIGH/EUR
        _circuitChainlink[0] = AggregatorV3Interface(0x9E8E794ad6Ecdb6d5c7eaBE059D30E907F58859b);
        return _circuitChainlink;
    }

    /// @inheritdoc BaseOracleChainlinkMultiTwoFeeds
    function read() public view override returns (uint256 quoteAmount) {
        quoteAmount = _readChainlinkFeed(_getQuoteAmount(), circuitChainlink()[0], 1, 8);
    }
}
