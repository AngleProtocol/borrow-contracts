// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.10;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

import "../interfaces/IOracle.sol";
import "../interfaces/ITreasury.sol";

// TODO check decimals -> incorrect at the moment

/// @title OracleChainlinkMulti
/// @author Angle Core Team
/// @notice Oracle contract, one contract is deployed per collateral/stablecoin pair: `vaultManager` contracts
/// could be using different interfaces
/// @dev This contract concerns an oracle that uses Chainlink with multiple pools to read from
contract OracleChainlinkMulti is IOracle {
    // ========================= Parameters and References =========================

    /// @notice Base used for computation
    uint256 public constant BASE = 10**18;

    /// @notice Chainlink pools, the order of the pools has to be the order in which they are read for the computation
    /// of the price
    AggregatorV3Interface[] public circuitChainlink;
    /// @notice Whether each rate for the pairs in `circuitChainlink` should be multiplied or divided
    uint8[] public circuitChainIsMultiplied;
    /// @notice Decimals for each Chainlink pairs
    uint8[] public chainlinkDecimals;
    /// @inheritdoc IOracle
    ITreasury public override treasury;
    /// @notice Unit of the in-currency
    uint256 public immutable inBase;
    /// @notice Description of the assets concerned by the oracle and the price outputted
    bytes32 public immutable description;
    /// @notice Represent the maximum amount of time (in seconds) between each Chainlink update
    /// before the price feed is considered stale
    uint32 public stalePeriod;

    // =================================== Event ===================================

    event StalePeriodUpdated(uint32 _stalePeriod);

    /// @notice Constructor for an oracle using Chainlink with multiple pools to read from
    /// @param _circuitChainlink Chainlink pool addresses (in order)
    /// @param _circuitChainIsMultiplied Whether we should multiply or divide by this rate
    /// @param _description Description of the assets concerned by the oracle
    constructor(
        address[] memory _circuitChainlink,
        uint8[] memory _circuitChainIsMultiplied,
        uint256 _inBase,
        uint32 _stalePeriod,
        address _treasury,
        bytes32 _description
    ) {
        inBase = _inBase;
        description = _description;
        uint256 circuitLength = _circuitChainlink.length;
        require(circuitLength > 0 && circuitLength == _circuitChainIsMultiplied.length, "32");
        for (uint256 i = 0; i < circuitLength; i++) {
            AggregatorV3Interface _pool = AggregatorV3Interface(_circuitChainlink[i]);
            circuitChainlink.push(_pool);
            chainlinkDecimals.push(_pool.decimals());
        }
        stalePeriod = _stalePeriod;
        circuitChainIsMultiplied = _circuitChainIsMultiplied;
        treasury = ITreasury(_treasury);
    }

    // ============================= Reading Oracles ===============================

    /// @inheritdoc IOracle
    function read() external view override returns (uint256 quoteAmount) {
        quoteAmount = BASE;
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
    /// @return The `quoteAmount` converted in out-currency (computed using the second return value)
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
