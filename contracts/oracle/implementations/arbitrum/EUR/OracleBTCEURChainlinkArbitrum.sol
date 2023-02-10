// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

import "../../../BaseOracleChainlinkMultiTwoFeeds.sol";

/// @title OracleBTCEURChainlinkArbitrum
/// @author Angle Labs, Inc.
/// @notice Gives the price of BTC in Euro in base 18
/// @dev This contract is built to be deployed on Arbitrum
contract OracleBTCEURChainlinkArbitrum is BaseOracleChainlinkMultiTwoFeeds {
    string public constant DESCRIPTION = "BTC/EUR Oracle";

    constructor(uint32 _stalePeriod, address _treasury) BaseOracleChainlinkMultiTwoFeeds(_stalePeriod, _treasury) {}

    /// @inheritdoc IOracle
    function circuitChainlink() public pure override returns (AggregatorV3Interface[] memory) {
        AggregatorV3Interface[] memory _circuitChainlink = new AggregatorV3Interface[](2);
        // Oracle BTC/USD
        _circuitChainlink[0] = AggregatorV3Interface(0x6ce185860a4963106506C203335A2910413708e9);
        // Oracle EUR/USD
        _circuitChainlink[1] = AggregatorV3Interface(0xA14d53bC1F1c0F31B4aA3BD109344E5009051a84);
        return _circuitChainlink;
    }
}
