// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

import "../../BaseFeedPTPendle.sol";

/// @title MorphoFeedPTezETHDec24
/// @author Angle Labs, Inc.
/// @notice Gives the price of PT-ezETH in ETH in base 18
contract MorphoFeedPTezETHDec24 is BaseFeedPTPendle {
    string public constant description = "PT-ezETH/weETH Oracle";

    constructor(
        IAccessControlManager accessControlManager,
        uint256 _maxImpliedRate,
        uint32 _twapDuration
    ) BaseFeedPTPendle(accessControlManager, _maxImpliedRate, _twapDuration) {}

    /*//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                       OVERRIDES                                                    
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////*/

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
