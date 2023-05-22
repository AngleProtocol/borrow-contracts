// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

import "../../../BaseOracleChainlinkMultiTwoFeeds.sol";

/// @title OracleIB01EURChainlink
/// @author Angle Labs, Inc.
/// @notice Gives the price of IB01 in Euro in base 18
contract OracleIB01EURChainlink is BaseOracleChainlinkMultiTwoFeeds {
    string public constant DESCRIPTION = "IB01/EUR Oracle";

    constructor(uint32 _stalePeriod, address _treasury) BaseOracleChainlinkMultiTwoFeeds(_stalePeriod, _treasury) {}

    /// @inheritdoc IOracle
    function circuitChainlink() public pure override returns (AggregatorV3Interface[] memory) {
        AggregatorV3Interface[] memory _circuitChainlink = new AggregatorV3Interface[](2);
        // Oracle IB01/USD
        _circuitChainlink[0] = AggregatorV3Interface(0x788D911ae7c95121A89A0f0306db65D87422E1de);
        // Oracle EUR/USD
        _circuitChainlink[1] = AggregatorV3Interface(0xb49f677943BC038e9857d61E7d053CaA2C1734C1);
        return _circuitChainlink;
    }
}
