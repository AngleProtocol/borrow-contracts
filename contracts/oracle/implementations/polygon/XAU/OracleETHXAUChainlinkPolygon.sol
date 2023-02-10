// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

import "../../../BaseOracleChainlinkMultiTwoFeeds.sol";

/// @title OracleETHXAUChainlinkPolygon
/// @author Angle Labs, Inc.
/// @notice Gives the price of ETH in XAU in base 18
/// @dev This contract is built to be deployed on Polygon
contract OracleETHXAUChainlinkPolygon is BaseOracleChainlinkMultiTwoFeeds {
    string public constant DESCRIPTION = "ETH/GOLD Oracle";

    constructor(uint32 _stalePeriod, address _treasury) BaseOracleChainlinkMultiTwoFeeds(_stalePeriod, _treasury) {}

    /// @inheritdoc IOracle
    function circuitChainlink() public pure override returns (AggregatorV3Interface[] memory) {
        AggregatorV3Interface[] memory _circuitChainlink = new AggregatorV3Interface[](2);
        // Oracle ETH/USD
        _circuitChainlink[0] = AggregatorV3Interface(0xF9680D99D6C9589e2a93a78A04A279e509205945);
        // Oracle XAU/USD
        _circuitChainlink[1] = AggregatorV3Interface(0x0C466540B2ee1a31b441671eac0ca886e051E410);
        return _circuitChainlink;
    }
}
