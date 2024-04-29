// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

import "../../BaseFeedPTPendle.sol";

/// @title MorphoFeedPTUSDe
/// @author Angle Labs, Inc.
/// @notice Gives the price of PT-USDe in ETH in base 18
contract MorphoFeedPTUSDe is BaseFeedPTPendle {
    string public constant description = "PT-USDe/USDe Oracle";

    constructor(
        IAccessControlManager accessControlManager,
        uint256 _maxImpliedRate,
        uint32 _twapDuration
    ) BaseFeedPTPendle(accessControlManager, _maxImpliedRate, _twapDuration) {}

    /*//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                       OVERRIDES                                                    
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////*/

    function asset() public pure override returns (address) {
        return 0x4c9EDD5852cd905f086C759E8383e09bff1E68B3;
    }

    function sy() public pure override returns (address) {
        return 0x42862F48eAdE25661558AFE0A630b132038553D0;
    }

    function maturity() public pure override returns (uint256) {
        return 1721865600;
    }

    function market() public pure override returns (address) {
        return 0x19588F29f9402Bb508007FeADd415c875Ee3f19F;
    }
}
