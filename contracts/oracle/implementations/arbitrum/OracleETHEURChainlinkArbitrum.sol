// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

import "../../BaseOracleChainlinkMulti.sol";

/// @title OracleETHEURChainlinkArbitrum
/// @author Angle Labs, Inc
/// @notice Gives the price of ETH in Euro in base 18
/// @dev This contract is built to be deployed on Arbitrum
contract OracleETHEURChainlinkArbitrum is BaseOracleChainlinkMulti {
    uint256 public constant OUTBASE = 10**18;
    string public constant DESCRIPTION = "ETH/EUR Oracle";

    /// @notice Constructor of the contract
    /// @param _stalePeriod Minimum feed update frequency for the oracle to not revert
    /// @param _treasury Treasury associated to the `VaultManager` which reads from this feed
    constructor(uint32 _stalePeriod, address _treasury) BaseOracleChainlinkMulti(_stalePeriod, _treasury) {}

    /// @inheritdoc IOracle
    function read() external view override returns (uint256 quoteAmount) {
        quoteAmount = OUTBASE;
        AggregatorV3Interface[2] memory circuitChainlink = [
            // Oracle ETH/USD
            AggregatorV3Interface(0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612),
            // Oracle EUR/USD
            AggregatorV3Interface(0xA14d53bC1F1c0F31B4aA3BD109344E5009051a84)
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
