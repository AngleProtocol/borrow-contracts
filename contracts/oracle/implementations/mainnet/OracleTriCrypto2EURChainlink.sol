// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

import "../../BaseOracleChainlinkMulti.sol";
import "../../../interfaces/external/curve/ICurveOracle.sol";

/// @title OracleTriCrypto2EURChainlink
/// @author Angle Labs, Inc.
/// @notice Gives the price of Curve TriCrypto2 in Euro in base 18
contract OracleTriCrypto2EURChainlink is BaseOracleChainlinkMulti {
    string public constant DESCRIPTION = "tricrypto2/EUR Oracle";
    ICurveOracle public constant TRI_CRYPTO_ORACLE = ICurveOracle(0xE8b2989276E2Ca8FDEA2268E3551b2b4B2418950);

    /// @notice Constructor of the contract
    /// @param _stalePeriod Minimum feed update frequency for the oracle to not revert
    /// @param _treasury Treasury associated to the `VaultManager` which reads from this feed
    constructor(uint32 _stalePeriod, address _treasury) BaseOracleChainlinkMulti(_stalePeriod, _treasury) {}

    function circuitChainlink() public pure returns (AggregatorV3Interface[2] memory) {
        return [
            // Chainlink USDT/USD address
            AggregatorV3Interface(0x3E7d1eAB13ad0104d2750B8863b489D65364e32D),
            // Chainlink EUR/USD address
            AggregatorV3Interface(0xb49f677943BC038e9857d61E7d053CaA2C1734C1)
        ];
    }

    /// @inheritdoc IOracle
    function read() external view override returns (uint256 quoteAmount) {
        quoteAmount = TRI_CRYPTO_ORACLE.lp_price();
        AggregatorV3Interface[2] memory _circuitChainlink = circuitChainlink();
        uint8[2] memory circuitChainIsMultiplied = [1, 0];
        uint8[2] memory chainlinkDecimals = [8, 8];
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
