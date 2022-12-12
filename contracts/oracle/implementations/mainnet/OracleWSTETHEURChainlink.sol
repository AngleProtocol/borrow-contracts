// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

import "../../BaseOracleChainlinkMultiTwoFeeds.sol";
import "../../../interfaces/external/lido/IStETH.sol";

/// @title OracleWSTETHEURChainlink
/// @author Angle Labs, Inc.
/// @notice Gives the price of wSTETH in Euro in base 18
contract OracleWSTETHEURChainlink is BaseOracleChainlinkMultiTwoFeeds {
    string public constant DESCRIPTION = "wSTETH/EUR Oracle";
    IStETH public constant STETH = IStETH(0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84);

    constructor(uint32 _stalePeriod, address _treasury) BaseOracleChainlinkMultiTwoFeeds(_stalePeriod, _treasury) {}

    /// @inheritdoc BaseOracleChainlinkMultiTwoFeeds
    function circuitChainlink() public pure override returns (AggregatorV3Interface[2] memory) {
        return [
            // Chainlink stETH/USD address
            AggregatorV3Interface(0xCfE54B5cD566aB89272946F602D76Ea879CAb4a8),
            // Chainlink EUR/USD address
            AggregatorV3Interface(0xb49f677943BC038e9857d61E7d053CaA2C1734C1)
        ];
    }

    /// @inheritdoc BaseOracleChainlinkMultiTwoFeeds
    function _getQuoteAmount() internal view override returns (uint256) {
        return STETH.getPooledEthByShares(1 ether);
    }
}
