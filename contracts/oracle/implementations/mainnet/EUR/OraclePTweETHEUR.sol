// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

import "../../../BaseOracleChainlinkMultiTwoFeeds.sol";
import "../../../BaseOraclePTPendle.sol";

/// @title OraclePTweETHEURChainlink
/// @author Angle Labs, Inc.
/// @notice Gives the price of PT-weETH in Euro in base 18
contract OraclePTweETHEUR is BaseOracleChainlinkMultiTwoFeeds, BaseOraclePTPendle {
    string public constant DESCRIPTION = "PT-weETH/EUR Oracle";

    constructor(
        uint32 _stalePeriod,
        address _treasury,
        uint256 _maxImpliedRate,
        uint32 _twapDuration
    ) BaseOracleChainlinkMultiTwoFeeds(_stalePeriod, _treasury) BaseOraclePTPendle(_maxImpliedRate, _twapDuration) {}

    /// @inheritdoc IOracle
    function circuitChainlink() public pure override returns (AggregatorV3Interface[] memory) {
        AggregatorV3Interface[] memory _circuitChainlink = new AggregatorV3Interface[](2);
        // Oracle weETH/USD
        _circuitChainlink[0] = AggregatorV3Interface(0xdDb6F90fFb4d3257dd666b69178e5B3c5Bf41136);
        // Oracle EUR/USD
        _circuitChainlink[1] = AggregatorV3Interface(0xb49f677943BC038e9857d61E7d053CaA2C1734C1);
        return _circuitChainlink;
    }

    /// @inheritdoc BaseOracleChainlinkMultiTwoFeeds
    function _getQuoteAmount()
        internal
        view
        override(BaseOraclePTPendle, BaseOracleChainlinkMultiTwoFeeds)
        returns (uint256)
    {
        return BaseOraclePTPendle._getQuoteAmount();
    }

    /*//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                       OVERRIDES                                                    
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////*/

    function ASSET() public pure override returns (address) {
        return 0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee;
    }

    function SY() public pure override returns (address) {
        return 0xAC0047886a985071476a1186bE89222659970d65;
    }

    function MATURITY() public pure override returns (uint256) {
        return 1719446400;
    }

    function MARKET() public pure override returns (address) {
        return 0xF32e58F92e60f4b0A37A69b95d642A471365EAe8;
    }

    function _onlyGovernorOrGuardian() internal view override {
        if (!treasury.isGovernorOrGuardian(msg.sender)) revert NotGovernorOrGuardian();
    }
}
