// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

import "../../../BaseOracleChainlinkMultiTwoFeeds.sol";
import "../../../../interfaces/external/IERC4626.sol";

/// @title OracleSTEURETHChainlinkArbitrum
/// @author Angle Labs, Inc.
/// @notice Gives the price of stEUR in ETH in base 18
contract OracleSTEURETHChainlinkArbitrum is BaseOracleChainlinkMultiTwoFeeds {
    string public constant DESCRIPTION = "stEUR/ETH Oracle";
    IERC4626 public constant STEUR = IERC4626(0x004626A008B1aCdC4c74ab51644093b155e59A23);

    constructor(uint32 _stalePeriod, address _treasury) BaseOracleChainlinkMultiTwoFeeds(_stalePeriod, _treasury) {}

    /// @inheritdoc IOracle
    function circuitChainlink() public pure override returns (AggregatorV3Interface[] memory) {
        AggregatorV3Interface[] memory _circuitChainlink = new AggregatorV3Interface[](2);
        // Oracle agEUR/USD
        _circuitChainlink[0] = AggregatorV3Interface(0x37963F10245e7c3a10c0E9d43a6E617B4Bc8440A);
        // Oracle ETH/USD
        _circuitChainlink[1] = AggregatorV3Interface(0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612);
        return _circuitChainlink;
    }

    /// @inheritdoc BaseOracleChainlinkMultiTwoFeeds
    function _getQuoteAmount() internal view override returns (uint256) {
        return STEUR.convertToAssets(1 ether);
    }

    // TODO: latestAnswer
}
