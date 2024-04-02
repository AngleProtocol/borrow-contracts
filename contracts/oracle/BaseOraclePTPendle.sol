// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

import { UNIT, UD60x18, ud } from "prb/math/UD60x18.sol";
import "pendle/interfaces/IPMarket.sol";
import { PendlePtOracleLib } from "pendle/oracles/PendlePtOracleLib.sol";
import "../interfaces/ITreasury.sol";

/// @title BaseOraclePTPendle
/// @author Angle Labs, Inc.
/// @notice Base oracle implementation for PT tokens on Pendle
abstract contract BaseOraclePTPendle {
    uint256 public constant BASE_18 = 1 ether;
    uint256 public constant YEAR = 365 days;
    // @notice The maximum implied rate for the underlying asset, if set well it allows to have a lower bound on the PT token price
    uint256 public maxImpliedRate;
    // @notice The duration of the TWAP used to calculate the PT price
    uint32 public twapDuration;

    /*//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                        EVENTS                                                      
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////*/

    event MaxImpliedRateUpdated(uint256 _maxImpliedRate);
    event TwapPTDurationUpdated(uint256 _twapDuration);

    constructor(uint256 _maxImpliedRate, uint32 _twapDuration) {
        maxImpliedRate = _maxImpliedRate;
        twapDuration = _twapDuration;
    }

    modifier onlyGovernorOrGuardian() {
        _onlyGovernorOrGuardian();
        _;
    }

    function _getQuoteAmount() internal view virtual returns (uint256) {
        uint256 economicalLowerBound = _economicalPTLowerBoundPrice();
        uint256 pendlePrice = _pendlePTPrice();
        uint256 minPrice = economicalLowerBound > pendlePrice ? pendlePrice : economicalLowerBound;
        uint256 quote = (_detectHackRatio() * minPrice) / BASE_18;
        return quote;
    }

    function setMaxImpliedRate(uint256 _maxImpliedRate) external onlyGovernorOrGuardian {
        maxImpliedRate = _maxImpliedRate;
        emit MaxImpliedRateUpdated(_maxImpliedRate);
    }

    function setTwapDuration(uint32 _twapDuration) external onlyGovernorOrGuardian {
        twapDuration = _twapDuration;
        emit TwapPTDurationUpdated(_twapDuration);
    }

    /*//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                       INTERNAL                                                     
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////*/

    function _economicalPTLowerBoundPrice() internal view returns (uint256) {
        uint256 exp = block.timestamp > maturity() ? 0 : maturity() - block.timestamp;
        if (exp == 0) return BASE_18;

        UD60x18 denominator = UNIT.add(ud(maxImpliedRate)).pow(ud(exp).div(ud(YEAR)));
        uint256 lowerBound = UNIT.div(denominator).unwrap();
        return lowerBound;
    }

    // TODO need to check what decimals the rate is returned if the underlying token is not in 18 decimals
    function _pendlePTPrice() internal view returns (uint256) {
        return PendlePtOracleLib.getPtToAssetRate(IPMarket(market()), twapDuration);
    }

    function _detectHackRatio() internal view returns (uint256) {
        uint256 assetBalanceSY = IERC20(asset()).balanceOf(sy());
        uint256 totalSupplySY = IERC20(sy()).totalSupply();
        return assetBalanceSY > totalSupplySY ? BASE_18 : (assetBalanceSY * BASE_18) / totalSupplySY;
    }

    /*//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                       OVERRIDES                                                    
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////*/

    function asset() public pure virtual returns (address);

    function sy() public pure virtual returns (address);

    function maturity() public pure virtual returns (uint256);

    function market() public pure virtual returns (address);

    function _onlyGovernorOrGuardian() internal view virtual;
}