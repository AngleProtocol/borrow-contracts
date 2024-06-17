// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

import "../../BaseFeedPTPendle.sol";

/// @title MorphoFeedPTweETH
/// @author Angle Labs, Inc.
/// @notice Gives the price of PT-weETH in ETH in base 18
contract MorphoFeedPTweETH is BaseFeedPTPendle {
    string public constant description = "PT-weETH/ETH Oracle";

    constructor(
        IAccessControlManager accessControlManager,
        uint256 _maxImpliedRate,
        uint32 _twapDuration
    ) BaseFeedPTPendle(accessControlManager, _maxImpliedRate, _twapDuration) {}

    /*//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                       OVERRIDES                                                    
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////*/
    function asset() public pure override returns (address) {
        return 0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee;
    }

    function sy() public pure override returns (address) {
        return 0xAC0047886a985071476a1186bE89222659970d65;
    }

    function maturity() public pure override returns (uint256) {
        return 1719446400;
    }

    function market() public pure override returns (address) {
        return 0xF32e58F92e60f4b0A37A69b95d642A471365EAe8;
    }
}
