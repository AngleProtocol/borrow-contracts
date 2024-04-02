// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import { console } from "forge-std/console.sol";
import { stdStorage, StdStorage, Test } from "forge-std/Test.sol";
import { MorphoFeedPTweETH, BaseFeedPTPendle } from "contracts/oracle/morpho/mainnet/MorphoFeedPTweETH.sol";
import { MockTreasury } from "contracts/mock/MockTreasury.sol";
import { IAgToken } from "contracts/interfaces/IAgToken.sol";
import { IMorphoChainlinkOracleV2Factory } from "contracts/interfaces/external/morpho/IMorphoChainlinkOracleV2Factory.sol";
import { IMorphoChainlinkOracleV2 } from "contracts/interfaces/external/morpho/IMorphoChainlinkOracleV2.sol";
import { IAccessControlManager } from "interfaces/IAccessControlManager.sol";
import "contracts/utils/Errors.sol" as Errors;
import "contracts/mock/MockCoreBorrow.sol";
import { PendlePtOracleLib } from "pendle/oracles/PendlePtOracleLib.sol";
import { IPMarket } from "pendle/interfaces/IPMarket.sol";
import "utils/src/Constants.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import { UNIT, UD60x18, ud, intoUint256 } from "prb/math/UD60x18.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { CommonUtils } from "utils/src/CommonUtils.sol";
import { IERC4626 } from "interfaces/external/IERC4626.sol";
import { PendlePtOracleLib } from "pendle/oracles/PendlePtOracleLib.sol";

contract MorphoChainlinkOracleTest is Test, CommonUtils {
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
    MorphoFeedPTweETH internal _oracle;
    IMorphoChainlinkOracleV2 public morphoOracle;
    IERC20Metadata public agToken;
    IERC20Metadata public collateral;
    IMorphoChainlinkOracleV2Factory constant MORPHO_FACTORY =
        IMorphoChainlinkOracleV2Factory(0x3A7bB36Ee3f3eE32A60e9f2b33c1e5f2E83ad766);

    function setUp() public {
        uint256 chainId = CHAIN_ETHEREUM;
        // arbitrumFork = vm.createFork(vm.envString("ETH_NODE_URI_ARBITRUM"));
        // avalancheFork = vm.createFork(vm.envString("ETH_NODE_URI_AVALANCHE"));
        ethereumFork = vm.createFork(vm.envString("ETH_NODE_URI_MAINNET"));
        // optimismFork = vm.createFork(vm.envString("ETH_NODE_URI_OPTIMISM"));
        // polygonFork = vm.createFork(vm.envString("ETH_NODE_URI_POLYGON"));
        // gnosisFork = vm.createFork(vm.envString("ETH_NODE_URI_GNOSIS"));
        // bnbFork = vm.createFork(vm.envString("ETH_NODE_URI_BSC"));
        // celoFork = vm.createFork(vm.envString("ETH_NODE_URI_CELO"));
        // polygonZkEVMFork = vm.createFork(vm.envString("ETH_NODE_URI_POLYGON_ZKEVM"));
        // baseFork = vm.createFork(vm.envString("ETH_NODE_URI_BASE"));
        // lineaFork = vm.createFork(vm.envString("ETH_NODE_URI_LINEA"));

        // forkIdentifier[CHAIN_ARBITRUM] = arbitrumFork;
        // forkIdentifier[CHAIN_AVALANCHE] = avalancheFork;
        forkIdentifier[CHAIN_ETHEREUM] = ethereumFork;
        // forkIdentifier[CHAIN_OPTIMISM] = optimismFork;
        // forkIdentifier[CHAIN_POLYGON] = polygonFork;
        // forkIdentifier[CHAIN_GNOSIS] = gnosisFork;
        // forkIdentifier[CHAIN_BNB] = bnbFork;
        // forkIdentifier[CHAIN_CELO] = celoFork;
        // forkIdentifier[CHAIN_POLYGONZKEVM] = polygonZkEVMFork;
        // forkIdentifier[CHAIN_BASE] = baseFork;
        // forkIdentifier[CHAIN_LINEA] = lineaFork;

        _TWAP_DURATION = 1 hours;
        _STALE_PERIOD = 24 hours;
        _MAX_IMPLIED_RATE = 0.5 ether;

        vm.selectFork(forkIdentifier[CHAIN_ETHEREUM]);
        coreBorrow = new MockCoreBorrow();
        coreBorrow.toggleGuardian(_guardian);
        coreBorrow.toggleGovernor(_governor);
        agToken = IERC20Metadata(0x0000206329b97DB379d5E1Bf586BbDB969C63274);
        _oracle = new MorphoFeedPTweETH(IAccessControlManager(address(coreBorrow)), _MAX_IMPLIED_RATE, _TWAP_DURATION);
        // Missing a vault like cntract to go from weETH to eeETH
        morphoOracle = MORPHO_FACTORY.createMorphoChainlinkOracleV2(
            IERC4626(address(0)),
            1,
            AggregatorV3Interface(address(_oracle)),
            AggregatorV3Interface(address(0xdDb6F90fFb4d3257dd666b69178e5B3c5Bf41136)),
            IERC20Metadata(address(0xc69Ad9baB1dEE23F4605a82b3354F8E40d1E5966)).decimals(),
            IERC4626(address(0)),
            1,
            AggregatorV3Interface(address(0)),
            AggregatorV3Interface(address(0)),
            agToken.decimals(),
            hex""
        );
    }

    function test_PTweETH_Success() public {
        (, int256 answer, , , ) = AggregatorV3Interface(address(0xdDb6F90fFb4d3257dd666b69178e5B3c5Bf41136))
            .latestRoundData();
        uint8 decimalCl = AggregatorV3Interface(address(0xdDb6F90fFb4d3257dd666b69178e5B3c5Bf41136)).decimals();
        (, int256 pricePT, , , ) = _oracle.latestRoundData();

        uint256 morphoPrice = morphoOracle.price();
        assertEq(10 ** 10, morphoOracle.SCALE_FACTOR());
        assertApproxEqRel(
            ((uint256(answer) * uint256(pricePT)) / 10 ** decimalCl) * 1 ether,
            morphoPrice,
            0.00001 ether
        );
        assertApproxEqRel(3100 ether, morphoPrice / 10 ** 18, 0.01 ether);
    }
}