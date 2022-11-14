// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

import "../../BaseOracleChainlinkMulti.sol";

/// @title OracleOPEURChainlinkOptimism
/// @author Angle Labs, Inc.
/// @notice Gives the price of OP in Euro in base 18
/// @dev This contract is built to be deployed on Optimism
contract OracleOPEURChainlinkOptimism is BaseOracleChainlinkMulti {
    uint256 public constant OUTBASE = 10**18;
    string public constant DESCRIPTION = "OP/EUR Oracle";

    /// @notice Constructor of the contract
    /// @param _stalePeriod Minimum feed update frequency for the oracle to not revert
    /// @param _treasury Treasury associated to the `VaultManager` which reads from this feed
    constructor(uint32 _stalePeriod, address _treasury) BaseOracleChainlinkMulti(_stalePeriod, _treasury) {}

    /// @inheritdoc IOracle
    function read() external view override returns (uint256 quoteAmount) {
        quoteAmount = OUTBASE;
        AggregatorV3Interface[2] memory circuitChainlink = [
            // Oracle OP/USD
            AggregatorV3Interface(0x0D276FC14719f9292D5C1eA2198673d1f4269246),
            // Oracle EUR/USD
            AggregatorV3Interface(0x3626369857A10CcC6cc3A6e4f5C2f5984a519F20)
        ];
        uint8[2] memory circuitChainIsMultiplied = [1, 0];
        uint8[2] memory chainlinkDecimals = [8, 8];
        for (uint256 i = 0; i < circuitChainlink.length; i++) {
            quoteAmount = _readChainlinkFeed(
                quoteAmount,
                circuitChainlink[i],
                circuitChainIsMultiplied[i],
                chainlinkDecimals[i]
            );
        }
    }
}
