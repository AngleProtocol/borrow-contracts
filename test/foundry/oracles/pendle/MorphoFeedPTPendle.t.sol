// SPDX-License-Identifier: MIT
pragma solidity ^0.8.12;

import { console } from "forge-std/console.sol";
import { stdStorage, StdStorage, Test } from "forge-std/Test.sol";
import { MorphoFeedPTweETH, BaseFeedPTPendle } from "borrow-contracts/oracle/morpho/mainnet/MorphoFeedPTweETH.sol";
import { MorphoFeedPTweETHDec24 } from "borrow-contracts/oracle/morpho/mainnet/MorphoFeedPTweETHDec24.sol";
import { MockTreasury } from "borrow-contracts/mock/MockTreasury.sol";
import { IAgToken } from "borrow-contracts/interfaces/IAgToken.sol";
import { IAccessControlManager } from "borrow-contracts/interfaces/IAccessControlManager.sol";
import "borrow-contracts/utils/Errors.sol" as Errors;
import "borrow-contracts/mock/MockCoreBorrow.sol";
import { PendlePtOracleLib } from "pendle/oracles/PendlePtOracleLib.sol";
import { IPMarket } from "pendle/interfaces/IPMarket.sol";
import "utils/src/Constants.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import { UNIT, UD60x18, ud, intoUint256 } from "prb/math/UD60x18.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MorphoFeedPTPendleTest is Test {
    using stdStorage for StdStorage;

    mapping(uint256 => uint256) internal forkIdentifier;
    uint256 public arbitrumFork;
    uint256 public avalancheFork;
    uint256 public ethereumFork;
    uint256 public optimismFork;
    uint256 public polygonFork;
    uint256 public gnosisFork;
    uint256 public bnbFork;
    uint256 public celoFork;
    uint256 public polygonZkEVMFork;
    uint256 public baseFork;
    uint256 public lineaFork;

    address internal _alice = address(uint160(uint256(keccak256(abi.encodePacked("alice")))));
    address internal _governor = address(uint160(uint256(keccak256(abi.encodePacked("governor")))));
    address internal _guardian = address(uint160(uint256(keccak256(abi.encodePacked("guardian")))));
    uint256 public constant YEAR = 365 days;
    uint32 internal _TWAP_DURATION;
    uint32 internal _STALE_PERIOD;
    uint256 internal _MAX_IMPLIED_RATE;

    MockCoreBorrow public coreBorrow;
    BaseFeedPTPendle internal _oracle;

    function setUp() public virtual {
        ethereumFork = vm.createFork(vm.envString("ETH_NODE_URI_ETHEREUM"), 19740549);
        forkIdentifier[CHAIN_ETHEREUM] = ethereumFork;

        _TWAP_DURATION = 1 hours;
        _STALE_PERIOD = 24 hours;
        _MAX_IMPLIED_RATE = 0.5 ether;

        vm.selectFork(forkIdentifier[CHAIN_ETHEREUM]);
        coreBorrow = new MockCoreBorrow();
        coreBorrow.toggleGuardian(_guardian);
        coreBorrow.toggleGovernor(_governor);
        _oracle = BaseFeedPTPendle(
            address(
                new MorphoFeedPTweETH(IAccessControlManager(address(coreBorrow)), _MAX_IMPLIED_RATE, _TWAP_DURATION)
            )
        );
    }

    function _economicLowerBound(uint256 maxImpliedRate, uint256 maturity) internal view returns (uint256) {
        uint256 exp = block.timestamp > maturity ? 0 : maturity - block.timestamp;
        if (exp == 0) return BASE_18;
        UD60x18 denominator = UNIT.add(ud(maxImpliedRate)).pow(ud(exp).div(ud(YEAR)));
        uint256 lowerBound = UNIT.div(denominator).unwrap();
        return lowerBound;
    }
}

contract MorphoFeedPTPendleCoreTest is MorphoFeedPTPendleTest {
    using stdStorage for StdStorage;

    function test_Decimals_Success() public {
        assertEq(_oracle.decimals(), uint8(18));
    }

    function test_Version_Success() public {
        assertEq(_oracle.version(), uint256(1));
    }

    /*//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                        SETTERS                                                     
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////*/

    function test_RevertWhen_SetMaxImpliedRate_NotAuthorized() public {
        vm.prank(_alice);
        vm.expectRevert(abi.encodeWithSelector(Errors.NotGovernorOrGuardian.selector));
        _oracle.setMaxImpliedRate(uint256(1e1));
    }

    function test_SetMaxImpliedRate_Success(uint256 maxRate1, uint256 maxRate2) public {
        vm.prank(_governor);
        _oracle.setMaxImpliedRate(uint256(maxRate1));
        assertEq(_oracle.maxImpliedRate(), uint256(maxRate1));

        vm.prank(_guardian);
        _oracle.setMaxImpliedRate(uint256(maxRate2));
        assertEq(_oracle.maxImpliedRate(), uint256(maxRate2));
    }

    function test_RevertWhen_SetTwapDuration_NotAuthorized() public {
        vm.prank(_alice);
        vm.expectRevert(abi.encodeWithSelector(Errors.NotGovernorOrGuardian.selector));
        _oracle.setMaxImpliedRate(10);
    }

    function test_SetTwapDuration_Success(uint32 twap1, uint32 twap2) public {
        twap1 = uint32(bound(twap1, 15 minutes, 365 days));
        twap2 = uint32(bound(twap2, 15 minutes, 365 days));

        vm.prank(_governor);
        _oracle.setTwapDuration(twap1);
        assertEq(_oracle.twapDuration(), uint256(twap1));

        vm.prank(_guardian);
        _oracle.setTwapDuration(twap2);
        assertEq(_oracle.twapDuration(), uint256(twap2));
    }

    /*//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                      CORE LOGIC                                                    
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////*/

    function test_Description_Success() public {
        assertEq(_oracle.description(), "PT-weETH/weETH Oracle");
    }

    function test_LatestRoundData_TimestampSuccess() public {
        (, , , uint256 updatedAt, ) = _oracle.latestRoundData();
        assertEq(updatedAt, 0);
    }

    function test_GetRoundData_TimestampSuccess(uint80 round) public {
        (, , , uint256 updatedAt, ) = _oracle.getRoundData(round);
        assertEq(updatedAt, 0);
    }

    function test_AllRoundEqual_Success(uint80 round) public {
        (, int256 lastAnswer, , , ) = _oracle.latestRoundData();
        (, int256 answer, , , ) = _oracle.getRoundData(round);
        assertEq(answer, lastAnswer);
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
