// SPDX-License-Identifier: MIT
pragma solidity ^0.8.12;

import "./MorphoFeedPTPendle.t.sol";
import { IAccessControlManager } from "borrow-contracts/interfaces/IAccessControlManager.sol";

contract MorphoFeedPTweETHTest is MorphoFeedPTPendleTest {
    using stdStorage for StdStorage;

    function setUp() public override {
        super.setUp();

        _TWAP_DURATION = 1 hours;
        _STALE_PERIOD = 24 hours;
        _MAX_IMPLIED_RATE = 0.5 ether;

        _oracle = new MorphoFeedPTweETH(IAccessControlManager(address(coreBorrow)), _MAX_IMPLIED_RATE, _TWAP_DURATION);
    }

    /*//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                      CORE LOGIC                                                    
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////*/

    function test_Description_Success() public {
        assertEq(_oracle.description(), "PT-weETH/weETH Oracle");
    }

    function test_Simple_Success() public {
        (, int256 answer, , , ) = _oracle.latestRoundData();
        uint256 value = uint256(answer);

        assertApproxEqAbs(value, 0.98 ether, 0.01 ether);
    }

    function test_EconomicalLowerBound_tooSmall() public {
        vm.prank(_governor);
        _oracle.setMaxImpliedRate(uint256(1e1));
        uint256 pendleAMMPrice = PendlePtOracleLib.getPtToAssetRate(IPMarket(_oracle.market()), _TWAP_DURATION);

        (, int256 answer, , , ) = _oracle.latestRoundData();
        uint256 value = uint256(answer);

        assertEq(value, pendleAMMPrice);
    }

    function test_AfterMaturity_Success() public {
        // Adavnce to the PT maturity
        vm.warp(_oracle.maturity());

        uint256 pendleAMMPrice = PendlePtOracleLib.getPtToAssetRate(IPMarket(_oracle.market()), _TWAP_DURATION);
        (, int256 answer, , , ) = _oracle.latestRoundData();
        uint256 value = uint256(answer);

        assertEq(value, pendleAMMPrice);
        assertEq(value, 1 ether);
    }

    function test_HackRemove_Success(uint256 slash) public {
        slash = bound(slash, 1, BASE_18);
        // Remove part of the SY backing collateral to simulate a hack
        IERC20 weETH = IERC20(address(_oracle.asset()));
        uint256 prevBalance = weETH.balanceOf(_oracle.sy());
        uint256 postBalance = (prevBalance * slash) / BASE_18;
        deal(address(weETH), _oracle.sy(), postBalance);

        uint256 lowerBound = _economicLowerBound(_MAX_IMPLIED_RATE, _oracle.maturity());
        (, int256 answer, , , ) = _oracle.latestRoundData();
        uint256 value = uint256(answer);

        assertLe(value, (lowerBound * slash) / BASE_18);
        if (slash > 0) assertGe(value, (lowerBound * (slash - 1)) / BASE_18);
    }

    function test_HackExpand_Success(uint256 expand) public {
        expand = bound(expand, BASE_18, BASE_18 * 1e7);
        // Remove part of the SY backing collateral to simulate a hack
        IERC20 weETH = IERC20(address(_oracle.asset()));
        uint256 prevBalance = weETH.balanceOf(_oracle.sy());
        uint256 postBalance = (prevBalance * expand) / BASE_18;
        deal(address(weETH), _oracle.sy(), postBalance);

        uint256 lowerBound = _economicLowerBound(_MAX_IMPLIED_RATE, _oracle.maturity());
        (, int256 answer, , , ) = _oracle.latestRoundData();
        uint256 value = uint256(answer);

        assertEq(value, lowerBound);
    }
}
