// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

import "../../../BaseOracleChainlinkMultiTwoFeeds.sol";

/// @title OracleUSDCEURChainlinkPolygon
/// @author Angle Labs, Inc.
/// @notice Gives the price of USDC in Euro in base 18
/// @dev This contract is built to be deployed on Polygon
contract OracleUSDCEURChainlinkPolygon is BaseOracleChainlinkMultiTwoFeeds {
    string public constant DESCRIPTION = "USDC/EUR Oracle";

    constructor(uint32 _stalePeriod, address _treasury) BaseOracleChainlinkMultiTwoFeeds(_stalePeriod, _treasury) {}

    /// @inheritdoc IOracle
    function circuitChainlink() public pure override returns (AggregatorV3Interface[] memory) {
        AggregatorV3Interface[] memory _circuitChainlink = new AggregatorV3Interface[](2);
        // Oracle USDC/USD
        _circuitChainlink[0] = AggregatorV3Interface(0xfE4A8cc5b5B2366C1B58Bea3858e81843581b2F7);
        // Oracle EUR/USD
        _circuitChainlink[1] = AggregatorV3Interface(0x73366Fe0AA0Ded304479862808e02506FE556a98);
        return _circuitChainlink;
    }
}
