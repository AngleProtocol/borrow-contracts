// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

import "../../../BaseOracleChainlinkMultiTwoFeeds.sol";
import "../../../../interfaces/external/etherFi/IEtherFiWeETH.sol";
import {pow} from "abdk/math/ABDKMath64x64.sol";

/// @title OraclePTweETHEURChainlink
/// @author Angle Labs, Inc.
/// @notice Gives the price of PT-weETH in Euro in base 18
contract OraclePTweETHEURChainlink is BaseOracleChainlinkMultiTwoFeeds {
    string public constant DESCRIPTION = "PT-weETH/EUR Oracle";
    IEtherFiWeETH public constant weETH = IEtherFiWeETH(0xdDb6F90fFb4d3257dd666b69178e5B3c5Bf41136);
    uint256 public constant BASE_18 = 1 ether;
    // TODO this need to be updated when the contract is deployed depending on the PT Token
    // @notice The maturity of the PT product
    uint256 public constant maturity = 0 + 180 days;
    // @notice The maximum implied rate for the underlying asset, if set well it allows to have a lower bound on the PT token price
    uint256 public maxImpliedRate = 30* 1e16;


    
    /*//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                        EVENTS                                                      
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////*/
    
    event MaxImpliedRateUpdated(uint256 _maxImpliedRate);


    constructor(uint32 _stalePeriod, address _treasury) BaseOracleChainlinkMultiTwoFeeds(_stalePeriod, _treasury) {}

    /// @inheritdoc IOracle
    function circuitChainlink() public pure override returns (AggregatorV3Interface[] memory) {
        AggregatorV3Interface[] memory _circuitChainlink = new AggregatorV3Interface[](2);
        // Oracle weETH/USD
        _circuitChainlink[0] = AggregatorV3Interface(0xdDb6F90fFb4d3257dd666b69178e5B3c5Bf41136);
        // Oracle EUR/USD
        _circuitChainlink[1] = AggregatorV3Interface(0xb49f677943BC038e9857d61E7d053CaA2C1734C1);
        return _circuitChainlink;
    }

    function setMaxImpliedRate(uint256 _maxImpliedRate) external {
        if (!treasury.isGovernorOrGuardian(msg.sender)) revert NotGovernorOrGuardian();
        maxImpliedRate = _maxImpliedRate;
        emit MaxImpliedRateUpdated(_maxImpliedRate);
    }

    /// @inheritdoc BaseOracleChainlinkMultiTwoFeeds
    function _getQuoteAmount() internal view override returns (uint256) {
        uint256 economicalLowerBound = _economicalPTLowerBoundPrice();
        uint256 pendlePrice = _pendlePTPrice();
        uint256 minPrice = economicalLowerBound>pendlePrice? pendlePrice: economicalLowerBound;
        uint256 quote = _detectHackRatio()*minPrice/BASE_18;
        return quote;
    }

    function _economicalPTLowerBoundPrice() internal view override returns (uint256) {
        uint256 exp = block.timestamp> maturity? 0: maturity-block.timestamp;
        uint256 denominator = exp==0? BASE_18: pow(BASE_18+ maxImpliedRate, exp);
        return BASE_18*pow(BASE_18,exp)/denominator;
    }

    function _pendlePTPrice() internal view override returns (uint256) {
        return IPMarket(market).getPtToAssetRate(twapDuration);
    }

    function _detectHackRatio() internal view override returns (uint256) {
        return BASE_18;
    }

}
