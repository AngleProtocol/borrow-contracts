// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

import "../../../BaseOracleChainlinkOneFeed.sol";
import "../../../../interfaces/external/lido/IStETH.sol";

/// @title OracleWSTETHUSDChainlink
/// @author Angle Labs, Inc.
/// @notice Gives the price of wSTETH in USD in base 18
contract OracleWSTETHUSDChainlink is BaseOracleChainlinkOneFeed {
    string public constant DESCRIPTION = "wSTETH/USD Oracle";
    IStETH public constant STETH = IStETH(0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84);

    constructor(uint32 _stalePeriod, address _treasury) BaseOracleChainlinkOneFeed(_stalePeriod, _treasury) {}

    /// @inheritdoc IOracle
    function circuitChainlink() public pure override returns (AggregatorV3Interface[] memory) {
        AggregatorV3Interface[] memory _circuitChainlink = new AggregatorV3Interface[](1);
        // Oracle stETH/USD
        _circuitChainlink[0] = AggregatorV3Interface(0xCfE54B5cD566aB89272946F602D76Ea879CAb4a8);
        return _circuitChainlink;
    }

    /// @inheritdoc BaseOracleChainlinkOneFeed
    function _getQuoteAmount() internal view override returns (uint256) {
        return STETH.getPooledEthByShares(1 ether);
    }
}
