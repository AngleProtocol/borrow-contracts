// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

import "./BaseOracleChainlinkMulti.sol";

/// @title OracleChainlinkMultiTemplate
/// @author Angle Labs, Inc
/// @notice Oracle contract, one contract is deployed per collateral/stablecoin pair
/// @dev This contract concerns an oracle that uses Chainlink with multiple pools to read from
/// @dev This is a template and a more gas-efficient implementation of the `OracleChainlinkMulti` contract
contract OracleChainlinkMultiTemplate is BaseOracleChainlinkMulti {
    // ===================== To be modified before deployment ======================
    uint256 public constant OUTBASE = 10**18;
    string public constant DESCRIPTION = "ETH/EUR Oracle";

    // =============================================================================

    /// @notice Constructor for an oracle using Chainlink with multiple pools to read from
    /// @param _stalePeriod Minimum feed update frequency for the oracle to not revert
    /// @param _treasury Treasury associated to the VaultManager which reads from this feed
    constructor(uint32 _stalePeriod, address _treasury) BaseOracleChainlinkMulti(_stalePeriod, _treasury) {}

    // ============================= Reading Oracles ===============================

    function circuitChainlink() public pure returns (AggregatorV3Interface[2] memory) {
        return [AggregatorV3Interface(address(0)), AggregatorV3Interface(address(0))];
    }

    /// @inheritdoc IOracle
    function read() external view override returns (uint256 quoteAmount) {
        quoteAmount = OUTBASE;
        // ===================== To be modified before deployment ==================
        AggregatorV3Interface[2] memory _circuitChainlink = circuitChainlink();
        uint8[2] memory circuitChainIsMultiplied = [0, 0];
        uint8[2] memory chainlinkDecimals = [0, 0];
        // =========================================================================
        for (uint256 i = 0; i < _circuitChainlink.length; i++) {
            quoteAmount = _readChainlinkFeed(
                quoteAmount,
                _circuitChainlink[i],
                circuitChainIsMultiplied[i],
                chainlinkDecimals[i]
            );
        }
    }
}
