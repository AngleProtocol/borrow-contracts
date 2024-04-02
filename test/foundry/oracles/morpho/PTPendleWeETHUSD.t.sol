// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import "../src/morpho-chainlink/MorphoChainlinkOracleV2.sol";
import { console } from "forge-std/console.sol";
import { stdStorage, StdStorage, Test } from "forge-std/Test.sol";
import { MorphoFeedPTweETH, BaseFeedPTPendle } from "contracts/oracle/morpho/mainnet/MorphoFeedPTweETH.sol";
import { MockTreasury } from "contracts/mock/MockTreasury.sol";
import { IAgToken } from "contracts/interfaces/IAgToken.sol";
import { IAccessControlManager } from "interfaces/IAccessControlManager.sol";
import "contracts/utils/Errors.sol" as Errors;
import "contracts/mock/MockCoreBorrow.sol";
import { PendlePtOracleLib } from "pendle/oracles/PendlePtOracleLib.sol";
import { IPMarket } from "pendle/interfaces/IPMarket.sol";
import "utils/src/Constants.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import { UNIT, UD60x18, ud, intoUint256 } from "prb/math/UD60x18.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
contract MorphoChainlinkOracleV2Test is Test {
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

    function setUp() public {
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
        _MAX_IMPLIED_RATE = 50 * 1e17;

        vm.selectFork(forkIdentifier[CHAIN_ETHEREUM]);
        coreBorrow = new MockCoreBorrow();
        coreBorrow.toggleGuardian(_guardian);
        coreBorrow.toggleGovernor(_governor);
        _oracle = new MorphoFeedPTweETH(IAccessControlManager(address(coreBorrow)), _MAX_IMPLIED_RATE, _TWAP_DURATION);
    }

    function testConstructorZeroVaultConversionSample() public {
        vm.expectRevert(bytes(ErrorsLib.VAULT_CONVERSION_SAMPLE_IS_ZERO));
        new MorphoChainlinkOracleV2(sDaiVault, 0, daiEthFeed, feedZero, 18, vaultZero, 1, usdcEthFeed, feedZero, 6);
        vm.expectRevert(bytes(ErrorsLib.VAULT_CONVERSION_SAMPLE_IS_ZERO));
        new MorphoChainlinkOracleV2(vaultZero, 1, daiEthFeed, feedZero, 18, sDaiVault, 0, usdcEthFeed, feedZero, 6);
    }

    function testConstructorVaultZeroNotOneSample(uint256 vaultConversionSample) public {
        vaultConversionSample = bound(vaultConversionSample, 2, type(uint256).max);

        vm.expectRevert(bytes(ErrorsLib.VAULT_CONVERSION_SAMPLE_IS_NOT_ONE));
        new MorphoChainlinkOracleV2(vaultZero, 0, daiEthFeed, feedZero, 18, vaultZero, 1, usdcEthFeed, feedZero, 6);
        vm.expectRevert(bytes(ErrorsLib.VAULT_CONVERSION_SAMPLE_IS_NOT_ONE));
        new MorphoChainlinkOracleV2(vaultZero, 1, daiEthFeed, feedZero, 18, vaultZero, 0, usdcEthFeed, feedZero, 6);
    }
}
