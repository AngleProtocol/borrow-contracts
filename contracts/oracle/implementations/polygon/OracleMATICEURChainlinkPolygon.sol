// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

import "../../BaseOracleChainlinkMultiTwoFeeds.sol";

/// @title OracleMATICEURChainlinkPolygon
/// @author Angle Labs, Inc.
/// @notice Gives the price of MATIC in Euro in base 18
/// @dev This contract is built to be deployed on Polygon
contract OracleMATICEURChainlinkPolygon is BaseOracleChainlinkMultiTwoFeeds {
    string public constant DESCRIPTION = "MATIC/EUR Oracle";

    constructor(uint32 _stalePeriod, address _treasury) BaseOracleChainlinkMultiTwoFeeds(_stalePeriod, _treasury) {}

    /// @inheritdoc IOracle
    function circuitChainlink() public pure override returns (AggregatorV3Interface[] memory) {
        AggregatorV3Interface[] memory _circuitChainlink = new AggregatorV3Interface[](2);
        // Oracle MATIC/USD
        _circuitChainlink[0] = AggregatorV3Interface(0xAB594600376Ec9fD91F8e885dADF0CE036862dE0);
        // Oracle EUR/USD
        _circuitChainlink[1] = AggregatorV3Interface(0x73366Fe0AA0Ded304479862808e02506FE556a98);
        return _circuitChainlink;
    }
}
