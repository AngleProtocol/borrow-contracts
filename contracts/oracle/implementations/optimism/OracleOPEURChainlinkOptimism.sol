// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

import "../../BaseOracleChainlinkMultiTwoFeeds.sol";

/// @title OracleOPEURChainlinkOptimism
/// @author Angle Labs, Inc.
/// @notice Gives the price of OP in Euro in base 18
/// @dev This contract is built to be deployed on Optimism
contract OracleOPEURChainlinkOptimism is BaseOracleChainlinkMultiTwoFeeds {
    string public constant DESCRIPTION = "OP/EUR Oracle";

    constructor(uint32 _stalePeriod, address _treasury) BaseOracleChainlinkMultiTwoFeeds(_stalePeriod, _treasury) {}

    /// @inheritdoc IOracle
    function circuitChainlink() public pure override returns (AggregatorV3Interface[] memory) {
        AggregatorV3Interface[] memory _circuitChainlink = new AggregatorV3Interface[](2);
        // Oracle OP/USD
        _circuitChainlink[0] = AggregatorV3Interface(0x0D276FC14719f9292D5C1eA2198673d1f4269246);
        // Oracle EUR/USD
        _circuitChainlink[1] = AggregatorV3Interface(0x3626369857A10CcC6cc3A6e4f5C2f5984a519F20);
        return _circuitChainlink;
    }
}
