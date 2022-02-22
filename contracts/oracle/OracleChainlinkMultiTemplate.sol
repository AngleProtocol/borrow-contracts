// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.10;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

import "../interfaces/IOracle.sol";
import "../interfaces/ITreasury.sol";

/// @title OracleChainlinkMultiTemplate
/// @author Angle Core Team
/// @notice Oracle contract, one contract is deployed per collateral/stablecoin pair
/// @dev This contract concerns an oracle that uses Chainlink with multiple pools to read from
/// @dev This is a template and a more gas-efficient implementation of the `OracleChainlinkMulti` contract
contract OracleChainlinkMultiTemplate is IOracle {
    // ===================== To be modified before deployment ======================
    uint256 public constant OUTBASE = 10**18;
    bytes32 public constant DESCRIPTION = "ETH/EUR Oracle";
    // =============================================================================

    // ========================= Parameters and References =========================

    /// @inheritdoc IOracle
    ITreasury public override treasury;
    /// @notice Represent the maximum amount of time (in seconds) between each Chainlink update
    /// before the price feed is considered stale
    uint32 public stalePeriod;

    // =================================== Event ===================================

    event StalePeriodUpdated(uint32 _stalePeriod);

    /// @notice Constructor for an oracle using Chainlink with multiple pools to read from
    /// @param _stalePeriod Minimum feed update frequency for the oracle to not revert
    /// @param _treasury Treasury associated to the VaultManager which reads from this feed
    constructor(uint32 _stalePeriod, address _treasury) {
        stalePeriod = _stalePeriod;
        treasury = ITreasury(_treasury);
    }

    // ============================= Reading Oracles ===============================

    /// @inheritdoc IOracle
    function read() external view override returns (uint256 quoteAmount) {
        quoteAmount = OUTBASE;
        // ===================== To be modified before deployment ==================
        AggregatorV3Interface[2] memory circuitChainlink = [
            AggregatorV3Interface(address(0)),
            AggregatorV3Interface(address(0))
        ];
        uint8[2] memory circuitChainIsMultiplied = [0, 0];
        uint8[2] memory chainlinkDecimals = [0, 0];
        // =========================================================================
        for (uint256 i = 0; i < circuitChainlink.length; i++) {
            quoteAmount = _readChainlinkFeed(
                quoteAmount,
                circuitChainlink[i],
                circuitChainIsMultiplied[i],
                chainlinkDecimals[i]
            );
        }
    }

    /// @notice Reads a Chainlink feed using a quote amount and converts the quote amount to
    /// the out-currency
    /// @param quoteAmount The amount for which to compute the price expressed with base decimal
    /// @param feed Chainlink feed to query
    /// @param multiplied Whether the ratio outputted by Chainlink should be multiplied or divided
    /// to the `quoteAmount`
    /// @param decimals Number of decimals of the corresponding Chainlink pair
    /// @return The `quoteAmount` converted in out-currency
    function _readChainlinkFeed(
        uint256 quoteAmount,
        AggregatorV3Interface feed,
        uint8 multiplied,
        uint256 decimals
    ) internal view returns (uint256) {
        (uint80 roundId, int256 ratio, , uint256 updatedAt, uint80 answeredInRound) = feed.latestRoundData();
        require(ratio > 0 && roundId <= answeredInRound && block.timestamp - updatedAt <= stalePeriod, "37");
        uint256 castedRatio = uint256(ratio);
        // Checking whether we should multiply or divide by the ratio computed
        if (multiplied == 1) return (quoteAmount * castedRatio) / (10**decimals);
        else return (quoteAmount * (10**decimals)) / castedRatio;
    }

    // ======================= Governance Related Functions ========================

    /// @notice Changes the stale period
    /// @param _stalePeriod New stale period (in seconds)
    function changeStalePeriod(uint32 _stalePeriod) external {
        require(treasury.isGovernorOrGuardian(msg.sender), "2");
        stalePeriod = _stalePeriod;
        emit StalePeriodUpdated(_stalePeriod);
    }

    /// @inheritdoc IOracle
    function setTreasury(address _treasury) external override {
        require(treasury.isVaultManager(msg.sender), "3");
        treasury = ITreasury(_treasury);
    }
}
