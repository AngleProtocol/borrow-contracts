// SPDX-License-Identifier: MIT
pragma solidity ^0.8.12;

import "./MorphoFeedPTPendle.t.sol";
import { IAccessControlManager } from "borrow-contracts/interfaces/IAccessControlManager.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

contract MorphoFeedPTezETHDec24Test is MorphoFeedPTPendleTest {
    using stdStorage for StdStorage;

    function setUp() public override {
        super.setUp();

        _TWAP_DURATION = 30 minutes;
        _STALE_PERIOD = 24 hours;
        _MAX_IMPLIED_RATE = 0.4 ether;

        _oracle = new MorphoFeedPTezETHDec24(
            IAccessControlManager(address(coreBorrow)),
            _MAX_IMPLIED_RATE,
            _TWAP_DURATION
        );
        syExchangeRate = IStandardizedYield(_oracle.sy()).exchangeRate();
    }

    /*//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                      CORE LOGIC                                                    
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////*/

    function test_Description_Success() public {
        assertEq(_oracle.description(), "PT-ezETH/ETH Oracle");
    }

    function test_Simple_Success() public {
        (, int256 answer, , , ) = _oracle.latestRoundData();
        uint256 value = uint256(answer);

        assertApproxEqAbs(value, 0.825 ether, 0.001 ether);
    }

    function test_EconomicalLowerBound_tooSmall() public {
        vm.prank(_governor);
        _oracle.setMaxImpliedRate(uint256(1e1));
        uint256 pendleAMMPrice = PendlePYOracleLib.getPtToSyRate(IPMarket(_oracle.market()), _TWAP_DURATION);
        (, int256 answer, , , ) = _oracle.latestRoundData();
        uint256 value = uint256(answer);

        assertEq(value, (pendleAMMPrice * _getAdditionalFeedRate()) / 1e8);
    }

    function test_AfterMaturity_Success() public {
        // Adavnce to the PT maturity
        vm.warp(_oracle.maturity());

        uint256 pendleAMMPrice = PendlePYOracleLib.getPtToSyRate(IPMarket(_oracle.market()), _TWAP_DURATION);
        (, int256 answer, , , ) = _oracle.latestRoundData();
        uint256 value = uint256(answer);

        assertEq(value, (pendleAMMPrice * _getAdditionalFeedRate()) / 1e8);
        assertApproxEqAbs(value, (1 ether * 1 ether * _getAdditionalFeedRate()) / syExchangeRate / 1e8, 100 wei);
    }

    // function test_HackRemove_Success(uint256 slash) public {
    //     slash = bound(slash, 1, BASE_18);
    //     // Remove part of the SY backing collateral to simulate a hack
    //     IERC20 ezETH = IERC20(address(_oracle.asset()));
    //     uint256 prevBalance = ezETH.balanceOf(_oracle.sy());
    //     uint256 postBalance = (prevBalance * slash) / BASE_18;
    //     deal(address(ezETH), _oracle.sy(), postBalance);

    //     uint256 lowerBound = _economicLowerBound(_MAX_IMPLIED_RATE, _oracle.maturity(), syExchangeRate);
    //     (, int256 answer, , , ) = _oracle.latestRoundData();
    //     uint256 value = uint256(answer);

    //     lowerBound = (lowerBound * _getAdditionalFeedRate()) / 1e8;

    //     assertLe(value, (lowerBound * slash) / BASE_18);
    //     if (slash > 0) assertGe(value, (lowerBound * (slash - 1)) / BASE_18);
    // }

    function test_HackExpand_Success(uint256 expand) public {
        expand = bound(expand, BASE_18, BASE_18 * 1e7);
        // Remove part of the SY backing collateral to simulate a hack
        IERC20 ezETH = IERC20(address(_oracle.asset()));
        uint256 prevBalance = ezETH.balanceOf(_oracle.sy());
        uint256 postBalance = (prevBalance * expand) / BASE_18;
        deal(address(ezETH), _oracle.sy(), postBalance);

        uint256 lowerBound = _economicLowerBound(_MAX_IMPLIED_RATE, _oracle.maturity(), syExchangeRate);
        (, int256 answer, , , ) = _oracle.latestRoundData();
        uint256 value = uint256(answer);

        lowerBound = (lowerBound * _getAdditionalFeedRate()) / 1e8;

        assertEq(value, lowerBound);
    }

    function _getAdditionalFeedRate() public view returns (uint256) {
        (, int256 ezETHETHRate, , , ) = AggregatorV3Interface(MorphoFeedPTezETHDec24(address(_oracle)).additionalFeed())
            .latestRoundData();
        return uint256(ezETHETHRate);
    }
}
