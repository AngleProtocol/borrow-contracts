// SPDX-License-Identifier: MIT
pragma solidity ^0.8.12;

import { console } from "forge-std/console.sol";
import { stdStorage, StdStorage, Test } from "forge-std/Test.sol";
import { OraclePTweETHEUR, BaseOracleChainlinkMulti } from "../../../../contracts/oracle/implementations/mainnet/EUR/OraclePTweETHEUR.sol";
import { MockTreasury } from "../../../../contracts/mock/MockTreasury.sol";
import { IAgToken } from "../../../../contracts/interfaces/IAgToken.sol";
import { PendlePtOracleLib } from "pendle/oracles/PendlePtOracleLib.sol";
import "pendle/interfaces/IPMarket.sol";
import "utils/src/Constants.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import { UNIT, UD60x18, ud, intoUint256 } from "prb/math/UD60x18.sol";
import "borrow-contracts/utils/Errors.sol" as ErrorsAngle;

contract BaseOraclePendlePT is Test {
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

    MockTreasury internal _contractTreasury;
    OraclePTweETHEUR internal _oracle;

    function setUp() public virtual {
        arbitrumFork = vm.createFork(vm.envString("ETH_NODE_URI_ARBITRUM"));
        avalancheFork = vm.createFork(vm.envString("ETH_NODE_URI_AVALANCHE"));
        ethereumFork = vm.createFork(vm.envString("ETH_NODE_URI_ETHEREUM"));
        optimismFork = vm.createFork(vm.envString("ETH_NODE_URI_OPTIMISM"));
        polygonFork = vm.createFork(vm.envString("ETH_NODE_URI_POLYGON"));
        gnosisFork = vm.createFork(vm.envString("ETH_NODE_URI_GNOSIS"));
        bnbFork = vm.createFork(vm.envString("ETH_NODE_URI_BSC"));
        celoFork = vm.createFork(vm.envString("ETH_NODE_URI_CELO"));
        polygonZkEVMFork = vm.createFork(vm.envString("ETH_NODE_URI_POLYGONZKEVM"));
        baseFork = vm.createFork(vm.envString("ETH_NODE_URI_BASE"));
        lineaFork = vm.createFork(vm.envString("ETH_NODE_URI_LINEA"));

        forkIdentifier[CHAIN_ARBITRUM] = arbitrumFork;
        forkIdentifier[CHAIN_AVALANCHE] = avalancheFork;
        forkIdentifier[CHAIN_ETHEREUM] = ethereumFork;
        forkIdentifier[CHAIN_OPTIMISM] = optimismFork;
        forkIdentifier[CHAIN_POLYGON] = polygonFork;
        forkIdentifier[CHAIN_GNOSIS] = gnosisFork;
        forkIdentifier[CHAIN_BNB] = bnbFork;
        forkIdentifier[CHAIN_CELO] = celoFork;
        forkIdentifier[CHAIN_POLYGONZKEVM] = polygonZkEVMFork;
        forkIdentifier[CHAIN_BASE] = baseFork;
        forkIdentifier[CHAIN_LINEA] = lineaFork;

        _TWAP_DURATION = 1 hours;
        _STALE_PERIOD = 24 hours;
        _MAX_IMPLIED_RATE = 0.5 ether;

        vm.selectFork(forkIdentifier[CHAIN_ETHEREUM]);
        _contractTreasury = new MockTreasury(
            IAgToken(address(0)),
            _governor,
            _guardian,
            address(0),
            address(0),
            address(0)
        );
        _oracle = new OraclePTweETHEUR(_STALE_PERIOD, address(_contractTreasury), _MAX_IMPLIED_RATE, _TWAP_DURATION);
    }

    /*//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                        HELPERS                                                     
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////*/

    function _updateChainlinkTimestamp(uint256 timestamp) internal {
        AggregatorV3Interface[] memory _circuitChainlink = _oracle.circuitChainlink();
        for (uint256 i; i < _circuitChainlink.length; ++i) {
            (
                uint80 roundId,
                int256 ratio,
                uint256 startedAt,
                uint256 updatedAt,
                uint80 answeredInRound
            ) = _circuitChainlink[i].latestRoundData();
            vm.mockCall(
                address(_circuitChainlink[i]),
                abi.encodeWithSelector(AggregatorV3Interface.latestRoundData.selector),
                abi.encode(roundId, ratio, startedAt, block.timestamp, answeredInRound)
            );
        }
    }

    function _read(uint256 quoteAmount) internal view returns (uint256) {
        AggregatorV3Interface[] memory _circuitChainlink = _oracle.circuitChainlink();
        uint8[2] memory circuitChainIsMultiplied = [1, 0];
        uint8[2] memory chainlinkDecimals = [8, 8];
        uint256 circuitLength = _circuitChainlink.length;
        for (uint256 i; i < circuitLength; ++i) {
            quoteAmount = _readChainlinkFeed(
                quoteAmount,
                _circuitChainlink[i],
                circuitChainIsMultiplied[i],
                chainlinkDecimals[i]
            );
        }
        return quoteAmount;
    }

    function _readChainlinkFeed(
        uint256 quoteAmount,
        AggregatorV3Interface feed,
        uint8 multiplied,
        uint256 decimals
    ) internal view returns (uint256) {
        (, int256 ratio, , , ) = feed.latestRoundData();
        uint256 castedRatio = uint256(ratio);
        // Checking whether we should multiply or divide by the ratio computed
        if (multiplied == 1) return (quoteAmount * castedRatio) / (10 ** decimals);
        else return (quoteAmount * (10 ** decimals)) / castedRatio;
    }

    function _economicLowerBound(uint256 maxImpliedRate, uint256 maturity) internal view returns (uint256) {
        uint256 exp = block.timestamp > maturity ? 0 : maturity - block.timestamp;
        if (exp == 0) return BASE_18;
        UD60x18 denominator = UNIT.add(ud(maxImpliedRate)).pow(ud(exp).div(ud(YEAR)));
        uint256 lowerBound = UNIT.div(denominator).unwrap();
        return lowerBound;
    }
}

contract BaseOraclePendlePTTest is BaseOraclePendlePT {
    using stdStorage for StdStorage;

    /*//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                        SETTERS                                                     
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////*/

    function test_RevertWhen_SetMaxImpliedRate_NotAuthorized() public {
        vm.prank(_alice);
        vm.expectRevert(abi.encodeWithSelector(BaseOracleChainlinkMulti.NotGovernorOrGuardian.selector));
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
        vm.expectRevert(abi.encodeWithSelector(BaseOracleChainlinkMulti.NotGovernorOrGuardian.selector));
        _oracle.setTwapDuration(10);
    }

    function test_RevertWhen_SetTwapDuration_TooLow() public {
        vm.prank(_governor);
        vm.expectRevert(abi.encodeWithSelector(ErrorsAngle.TwapDurationTooLow.selector));
        _oracle.setTwapDuration(10);
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

    function test_Simple_Success() public {
        _oracle.read();
    }

    function test_EconomicalLowerBound_tooSmall() public {
        vm.prank(_governor);
        _oracle.setMaxImpliedRate(uint256(1e1));
        uint256 pendleAMMPrice = PendlePtOracleLib.getPtToAssetRate(IPMarket(_oracle.market()), _TWAP_DURATION);

        assertEq(_oracle.read(), _read(pendleAMMPrice));
    }

    function test_AfterMaturity_Success() public {
        // Adavnce to the PT maturity
        vm.warp(_oracle.maturity());

        // Update the last timestamp oracle push
        _updateChainlinkTimestamp(block.timestamp);

        uint256 pendleAMMPrice = PendlePtOracleLib.getPtToAssetRate(IPMarket(_oracle.market()), _TWAP_DURATION);
        uint256 value = _oracle.read();
        assertEq(value, _read(pendleAMMPrice));
        assertEq(value, _read(1 ether));
    }

    function test_HackRemove_Success(uint256 slash) public {
        slash = bound(slash, 1, BASE_18);
        // Remove part of the SY backing collateral to simulate a hack
        IERC20 weETH = IERC20(address(_oracle.asset()));
        uint256 prevBalance = weETH.balanceOf(_oracle.sy());
        uint256 postBalance = (prevBalance * slash) / BASE_18;
        deal(address(weETH), _oracle.sy(), postBalance);

        uint256 lowerBound = _economicLowerBound(_MAX_IMPLIED_RATE, _oracle.maturity());
        uint256 value = _oracle.read();

        assertLe(value, _read((lowerBound * slash) / BASE_18));
        if (slash > 0) assertGe(value, _read((lowerBound * (slash - 1)) / BASE_18));
    }

    function test_HackExpand_Success(uint256 expand) public {
        expand = bound(expand, BASE_18, BASE_18 * 1e7);
        // Remove part of the SY backing collateral to simulate a hack
        IERC20 weETH = IERC20(address(_oracle.asset()));
        uint256 prevBalance = weETH.balanceOf(_oracle.sy());
        uint256 postBalance = (prevBalance * expand) / BASE_18;
        deal(address(weETH), _oracle.sy(), postBalance);

        uint256 lowerBound = _economicLowerBound(_MAX_IMPLIED_RATE, _oracle.maturity());
        uint256 value = _oracle.read();

        assertEq(value, _read((lowerBound)));
    }
}
