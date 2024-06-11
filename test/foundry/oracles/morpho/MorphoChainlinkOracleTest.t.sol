// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import { console } from "forge-std/console.sol";
import { stdStorage, StdStorage, Test } from "forge-std/Test.sol";
import { MorphoFeedPTweETH, BaseFeedPTPendle } from "borrow-contracts/oracle/morpho/mainnet/MorphoFeedPTweETH.sol";
import { MorphoFeedPTUSDe } from "borrow-contracts/oracle/morpho/mainnet/MorphoFeedPTUSDe.sol";
import { MockTreasury } from "borrow-contracts/mock/MockTreasury.sol";
import { IAgToken } from "borrow-contracts/interfaces/IAgToken.sol";
import { IMorphoChainlinkOracleV2Factory } from "borrow-contracts/interfaces/external/morpho/IMorphoChainlinkOracleV2Factory.sol";
import { IMorphoChainlinkOracleV2 } from "borrow-contracts/interfaces/external/morpho/IMorphoChainlinkOracleV2.sol";
import { IAccessControlManager } from "borrow-contracts/interfaces/IAccessControlManager.sol";
import "borrow-contracts/utils/Errors.sol" as Errors;
import "borrow-contracts/mock/MockCoreBorrow.sol";
import { PendlePtOracleLib } from "pendle/oracles/PendlePtOracleLib.sol";
import { IPMarket } from "pendle/interfaces/IPMarket.sol";
import "utils/src/Constants.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import { UNIT, UD60x18, ud, intoUint256 } from "prb/math/UD60x18.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { CommonUtils } from "utils/src/CommonUtils.sol";
import { IERC4626 } from "borrow-contracts/interfaces/external/IERC4626.sol";
import { PendlePtOracleLib } from "pendle/oracles/PendlePtOracleLib.sol";

contract MorphoChainlinkOracleTest is Test, CommonUtils {
    using stdStorage for StdStorage;

    address internal _alice = address(uint160(uint256(keccak256(abi.encodePacked("alice")))));
    address internal _governor = address(uint160(uint256(keccak256(abi.encodePacked("governor")))));
    address internal _guardian = address(uint160(uint256(keccak256(abi.encodePacked("guardian")))));
    address constant PTWeETH = 0xc69Ad9baB1dEE23F4605a82b3354F8E40d1E5966;
    address constant PTUSDe = 0xa0021EF8970104c2d008F38D92f115ad56a9B8e1;
    address constant oracleWeETH = 0xdDb6F90fFb4d3257dd666b69178e5B3c5Bf41136;
    address constant oracleUSDe = 0xbC5FBcf58CeAEa19D523aBc76515b9AEFb5cfd58;

    uint256 public constant YEAR = 365 days;
    uint32 internal _TWAP_DURATION;
    uint32 internal _STALE_PERIOD;
    uint256 internal _MAX_IMPLIED_RATE;

    MockCoreBorrow public coreBorrow;
    BaseFeedPTPendle internal _oracle;
    IMorphoChainlinkOracleV2 public morphoOracle;
    IERC20Metadata public agToken;
    IERC20Metadata public collateral;
    IMorphoChainlinkOracleV2Factory constant MORPHO_FACTORY =
        IMorphoChainlinkOracleV2Factory(0x3A7bB36Ee3f3eE32A60e9f2b33c1e5f2E83ad766);

    function setUp() public {
        uint256 chainId = CHAIN_ETHEREUM;
        ethereumFork = vm.createFork(vm.envString("ETH_NODE_URI_ETHEREUM"), 19739302);
        forkIdentifier[CHAIN_ETHEREUM] = ethereumFork;

        _TWAP_DURATION = 15 minutes;
        _STALE_PERIOD = 24 hours;
        _MAX_IMPLIED_RATE = 0.5 ether;

        vm.selectFork(forkIdentifier[CHAIN_ETHEREUM]);
        coreBorrow = new MockCoreBorrow();
        coreBorrow.toggleGuardian(_guardian);
        coreBorrow.toggleGovernor(_governor);
        agToken = IERC20Metadata(0x0000206329b97DB379d5E1Bf586BbDB969C63274);
    }

    function test_PTweETH_Success() public {
        _oracle = BaseFeedPTPendle(
            address(
                new MorphoFeedPTweETH(IAccessControlManager(address(coreBorrow)), _MAX_IMPLIED_RATE, _TWAP_DURATION)
            )
        );
        // Missing a vault like cntract to go from weETH to eeETH
        morphoOracle = MORPHO_FACTORY.createMorphoChainlinkOracleV2(
            IERC4626(address(0)),
            1,
            AggregatorV3Interface(address(_oracle)),
            AggregatorV3Interface(address(oracleWeETH)),
            IERC20Metadata(address(PTWeETH)).decimals(),
            IERC4626(address(0)),
            1,
            AggregatorV3Interface(address(0)),
            AggregatorV3Interface(address(0)),
            agToken.decimals(),
            hex""
        );
        (, int256 answer, , , ) = AggregatorV3Interface(address(oracleWeETH)).latestRoundData();
        uint8 decimalCl = AggregatorV3Interface(address(oracleWeETH)).decimals();
        (, int256 pricePT, , , ) = _oracle.latestRoundData();

        uint256 morphoPrice = morphoOracle.price();
        assertEq(10 ** 10, morphoOracle.SCALE_FACTOR());
        assertApproxEqRel(
            ((uint256(answer) * uint256(pricePT)) / 10 ** decimalCl) * 1 ether,
            morphoPrice,
            0.00001 ether
        );
        assertApproxEqRel(3040 ether, morphoPrice / 10 ** 18, 0.01 ether);
    }

    function test_PTUSDe_Success() public {
        _oracle = BaseFeedPTPendle(
            address(new MorphoFeedPTUSDe(IAccessControlManager(address(coreBorrow)), _MAX_IMPLIED_RATE, _TWAP_DURATION))
        );
        // Missing a vault like cntract to go from weETH to eeETH
        morphoOracle = MORPHO_FACTORY.createMorphoChainlinkOracleV2(
            IERC4626(address(0)),
            1,
            AggregatorV3Interface(address(_oracle)),
            AggregatorV3Interface(oracleUSDe),
            IERC20Metadata(PTUSDe).decimals(),
            IERC4626(address(0)),
            1,
            AggregatorV3Interface(address(0)),
            AggregatorV3Interface(address(0)),
            agToken.decimals(),
            hex""
        );
        (, int256 answer, , , ) = AggregatorV3Interface(oracleUSDe).latestRoundData();
        uint8 decimalCl = AggregatorV3Interface(oracleUSDe).decimals();
        (, int256 pricePT, , , ) = _oracle.latestRoundData();

        uint256 morphoPrice = morphoOracle.price();
        assertEq(10 ** 10, morphoOracle.SCALE_FACTOR());
        assertApproxEqRel(
            ((uint256(answer) * uint256(pricePT)) / 10 ** decimalCl) * 1 ether,
            morphoPrice,
            0.00001 ether
        );
        assertApproxEqRel(0.9 ether, morphoPrice / 10 ** 18, 0.01 ether);
    }
}
