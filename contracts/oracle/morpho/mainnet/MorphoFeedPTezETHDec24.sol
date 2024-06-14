// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

import "../../BaseFeedPTPendle.sol";
import "../../FeedPTForSY.sol";

/// @title MorphoFeedPTezETHDec24
/// @author Angle Labs, Inc.
/// @notice Gives the price of PT-ezETH in ETH in base 18
contract MorphoFeedPTezETHDec24 is BaseFeedPTPendle, FeedPTForSY {
    string public constant description = "PT-ezETH/ETH Oracle";

    // Redstone Feed ezETH/ETH
    AggregatorV3Interface public constant additionalFeed =
        AggregatorV3Interface(0xF4a3e183F59D2599ee3DF213ff78b1B3b1923696);

    constructor(
        IAccessControlManager accessControlManager,
        uint256 _maxImpliedRate,
        uint32 _twapDuration
    ) BaseFeedPTPendle(accessControlManager, _maxImpliedRate, _twapDuration) {}

    /*//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                       OVERRIDES                                                    
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////*/

    /// @inheritdoc AggregatorV3Interface
    function getRoundData(
        uint80 _roundId
    )
        external
        view
        override
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        (, int256 ratio, , , ) = additionalFeed.latestRoundData();
        return (0, ((int256(_getQuoteAmount()) * ratio) / 10 ** 8), 0, 0, 0);
    }

    /// @inheritdoc AggregatorV3Interface
    function latestRoundData()
        external
        view
        override
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        (, int256 ratio, , , ) = additionalFeed.latestRoundData();
        return (0, ((int256(_getQuoteAmount()) * ratio) / 10 ** 8), 0, 0, 0);
    }

    function _pendlePTPrice(
        IPMarket _market,
        uint32 _twapDuration
    ) internal view override(BaseOraclePTPendle, FeedPTForSY) returns (uint256, uint256) {
        return FeedPTForSY._pendlePTPrice(_market, _twapDuration);
    }

    function asset() public pure override returns (address) {
        return 0xbf5495Efe5DB9ce00f80364C8B423567e58d2110;
    }

    function sy() public pure override returns (address) {
        return 0x22E12A50e3ca49FB183074235cB1db84Fe4C716D;
    }

    function maturity() public pure override returns (uint256) {
        return 1735171200;
    }

    function market() public pure override returns (address) {
        return 0xD8F12bCDE578c653014F27379a6114F67F0e445f;
    }
}
