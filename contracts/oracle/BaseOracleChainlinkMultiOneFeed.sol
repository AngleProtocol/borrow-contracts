// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

import "./BaseOracleChainlinkMulti.sol";

/// @title BaseOracleChainlinkMultiOneFeed
/// @author Angle Labs, Inc.
/// @notice Base contract for an oracle that reads into one Chainlink feeds with 8 decimals
abstract contract BaseOracleChainlinkMultiOneFeed is BaseOracleChainlinkMulti {
    constructor(uint32 _stalePeriod, address _treasury) BaseOracleChainlinkMulti(_stalePeriod, _treasury) {}

    /// @notice Returns the quote amount of the oracle contract
    function _getQuoteAmount() internal view virtual returns (uint256) {
        return 10 ** 18;
    }

    /// @inheritdoc IOracle
    function read() external view virtual override returns (uint256 quoteAmount) {
        AggregatorV3Interface[] memory _circuitChainlink = circuitChainlink();
        quoteAmount = _readChainlinkFeed(_getQuoteAmount(), _circuitChainlink[0], 1, 8);
    }
}
