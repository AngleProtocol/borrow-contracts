// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

import { PendlePYOracleLib, PMath } from "pendle/oracles/PendlePYOracleLib.sol";
import "pendle/interfaces/IPMarket.sol";

/// @title FeedPTForSY
/// @author Angle Labs, Inc.
/// @notice Override the BaseFeedPTPendle to provide the price of PT tokens based on the ibToken and not the underlying token
abstract contract FeedPTForSY {
    using PMath for uint256;

    /// @dev Depending on the market you should use
    ///       - getPtToSy() should be used if the underlying token is tradable,
    ///       - getPtToAsset() if not
    /// @dev https://docs.pendle.finance/Developers/Contracts/StandardizedYield#asset-of-sy--assetinfo-function
    function _pendlePTPrice(IPMarket _market, uint32 _twapDuration) internal view virtual returns (uint256, uint256) {
        (uint256 syIndex, uint256 pyIndex) = PendlePYOracleLib.getSYandPYIndexCurrent(_market);
        if (syIndex >= pyIndex) {
            return (PendlePYOracleLib.getPtToAssetRateRaw(_market, _twapDuration).divDown(syIndex), syIndex);
        } else {
            return (PendlePYOracleLib.getPtToAssetRateRaw(_market, _twapDuration).divDown(pyIndex), syIndex);
        }
    }
}
