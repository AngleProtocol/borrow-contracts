// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

import { UNIT, UD60x18, ud, intoUint256 } from "prb/math/UD60x18.sol";
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
        uint256 exp = block.timestamp > MATURITY() ? 0 : MATURITY() - block.timestamp;
        if (exp == 0) return BASE_18;

        UD60x18 denominator = UNIT.add(ud(maxImpliedRate)).pow(ud(exp).div(ud(YEAR)));
        uint256 lowerBound = UNIT.div(denominator).unwrap();
        return lowerBound;
    }

    function _pendlePTPrice() internal view returns (uint256) {
        return PendlePtOracleLib.getPtToAssetRate(IPMarket(MARKET()), twapDuration);
    }

    function _detectHackRatio() internal view returns (uint256) {
        uint256 assetBalanceSY = IERC20(ASSET()).balanceOf(SY());
        uint256 totalSupplySY = IERC20(SY()).totalSupply();
        return assetBalanceSY > totalSupplySY ? BASE_18 : (assetBalanceSY * BASE_18) / totalSupplySY;
    }

    /*//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                       OVERRIDES                                                    
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////*/

    function ASSET() public pure virtual returns (address);

    function SY() public pure virtual returns (address);

    function MATURITY() public pure virtual returns (uint256);

    function MARKET() public pure virtual returns (address);

    function _onlyGovernorOrGuardian() internal view virtual;
}
