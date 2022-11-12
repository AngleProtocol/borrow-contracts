// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.12;

import "@openzeppelin/contracts-upgradeable/interfaces/IERC20MetadataUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import "../../BaseTest.test.sol";
import { AToken } from "../../../../contracts/interfaces/external/aave/AToken.sol";
import "../../../../contracts/interfaces/IBorrowStaker.sol";
import "../../../../contracts/interfaces/ICoreBorrow.sol";
import "../../../../contracts/interfaces/external/curve/IMetaPool3.sol";
import { ITricrypto3 } from "../../../../contracts/interfaces/external/curve/ITricrypto3.sol";
import "../../../../contracts/interfaces/coreModule/IStableMaster.sol";
import "../../../../contracts/interfaces/coreModule/IPoolManager.sol";
import "../../../../contracts/mock/MockTokenPermit.sol";
import { CurveRemovalType, SwapType, BaseLevSwapper, MockCurveLevSwapper5TokensWithBP, SwapperSidechain, IUniswapV3Router, IAngleRouterSidechain } from "../../../../contracts/mock/MockCurveLevSwapper5TokensWithBP.sol";
import { MockBorrowStaker } from "../../../../contracts/mock/MockBorrowStaker.sol";

// @dev Testing on Polygon
contract CurveLevSwapper5TokensWithBPTest is BaseTest {
    using stdStorage for StdStorage;
    using SafeERC20 for IERC20;

    address internal constant _ONE_INCH = 0x1111111254fb6c44bAC0beD2854e76F90643097d;
    IUniswapV3Router internal constant _UNI_V3_ROUTER = IUniswapV3Router(0xE592427A0AEce92De3Edee1F18E0157C05861564);
    IAngleRouterSidechain internal constant _ANGLE_ROUTER =
        IAngleRouterSidechain(address(uint160(uint256(keccak256(abi.encodePacked("_fakeAngleRouter"))))));
    IERC20 public asset = IERC20(0xdAD97F7713Ae9437fa9249920eC8507e5FbB23d3);
    IERC20 internal constant _USDC = IERC20(0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174);
    IERC20 internal constant _USDT = IERC20(0xc2132D05D31c914a87C6611C10748AEb04B58e8F);
    IERC20 internal constant _DAI = IERC20(0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063);
    IERC20 internal constant _WBTC = IERC20(0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6);
    IERC20 internal constant _WETH = IERC20(0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619);
    IERC20 internal constant _amUSDC = IERC20(0x1a13F4Ca1d028320A707D99520AbFefca3998b7F);
    IERC20 internal constant _amUSDT = IERC20(0x60D55F02A771d515e077c9C2403a1ef324885CeC);
    IERC20 internal constant _amDAI = IERC20(0x27F8D03b3a2196956ED754baDc28D73be8830A6e);
    IERC20 internal constant _AaveBPToken = IERC20(0xE7a24EF0C5e95Ffb0f6684b813A78F2a3AD7D171);
    IERC20 internal constant _amWBTC = IERC20(0x5c2ed810328349100A66B82b78a1791B101C9D61);
    IERC20 internal constant _amWETH = IERC20(0x28424507fefb6f7f8E9D3860F56504E4e5f5f390);
    uint256 internal constant _DECIMAL_NORM_USDC = 10**12;
    uint256 internal constant _DECIMAL_NORM_USDT = 10**12;
    uint256 internal constant _DECIMAL_NORM_WBTC = 10**10;

    IMetaPool3 internal constant _METAPOOL = IMetaPool3(0x1d8b86e3D88cDb2d34688e87E72F388Cb541B7C8);
    IMetaPool3 internal constant _UNDERLYING_METAPOOL = IMetaPool3(0x92215849c439E1f8612b6646060B4E3E5ef822cC);
    IMetaPool3 internal constant _AAVE_BPPOOL = IMetaPool3(0x445FE580eF8d70FF569aB36e80c647af338db351);
    address internal constant _AAVE_LENDING_POOL = 0x8dFf5E27EA6b7AC08EbFdf9eB090F32ee9a30fcf;

    // payload to swap 100000 USDC for amUSDC on 1inch
    bytes internal constant _PAYLOAD_USDC =
        hex"7c0252000000000000000000000000000d15038f8a0362b4ce71d6c879d56bf9fc2884cf000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000001800000000000000000000000002791bca1f2de4661ed88a30c99a7a9449aa841740000000000000000000000001a13f4ca1d028320a707d99520abfefca3998b7f0000000000000000000000000d15038f8a0362b4ce71d6c879d56bf9fc2884cf0000000000000000000000000b7108E278c2E77E4e4f5c93d9E5e9A11AC837FC000000000000000000000000000000000000000000000000000000174876e800000000000000000000000000000000000000000000000000000000170cdc1e00000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000011c0000000000000000000000000000000000000000000000000000de0000b051208dff5e27ea6b7ac08ebfdf9eb090f32ee9a30fcf2791bca1f2de4661ed88a30c99a7a9449aa841740024e8eda9df0000000000000000000000002791bca1f2de4661ed88a30c99a7a9449aa8417400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000d15038f8a0362b4ce71d6c879d56bf9fc2884cf000000000000000000000000000000000000000000000000000000000000044d80a06c4eca271a13f4ca1d028320a707d99520abfefca3998b7f1111111254fb6c44bac0bed2854e76f90643097d000000000000000000000000000000000000000000000000000000174876e80000000000cfee7c08";
    // payload to swap 100000 DAI for amDAI on 1inch
    bytes internal constant _PAYLOAD_DAI =
        hex"7c0252000000000000000000000000000d15038f8a0362b4ce71d6c879d56bf9fc2884cf000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000001800000000000000000000000008f3cf7ad23cd3cadbd9735aff958023239c6a06300000000000000000000000027f8d03b3a2196956ed754badc28d73be8830a6e0000000000000000000000000d15038f8a0362b4ce71d6c879d56bf9fc2884cf0000000000000000000000000b7108E278c2E77E4e4f5c93d9E5e9A11AC837FC00000000000000000000000000000000000000000000152d02c7e14af68000000000000000000000000000000000000000000000000014f6ccfe338517e00000000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000011c0000000000000000000000000000000000000000000000000000de0000b051208dff5e27ea6b7ac08ebfdf9eb090f32ee9a30fcf8f3cf7ad23cd3cadbd9735aff958023239c6a0630024e8eda9df0000000000000000000000008f3cf7ad23cd3cadbd9735aff958023239c6a06300000000000000000000000000000000000000000000000000000000000000000000000000000000000000000d15038f8a0362b4ce71d6c879d56bf9fc2884cf000000000000000000000000000000000000000000000000000000000000044d80a06c4eca2727f8d03b3a2196956ed754badc28d73be8830a6e1111111254fb6c44bac0bed2854e76f90643097d00000000000000000000000000000000000000000000152d02c7e14af680000000000000cfee7c08";
    // payload to swap 100000 USDT for amUSDT on 1inch
    bytes internal constant _PAYLOAD_USDT =
        hex"7c0252000000000000000000000000000d15038f8a0362b4ce71d6c879d56bf9fc2884cf00000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000180000000000000000000000000c2132d05d31c914a87c6611c10748aeb04b58e8f00000000000000000000000060d55f02a771d515e077c9c2403a1ef324885cec0000000000000000000000000d15038f8a0362b4ce71d6c879d56bf9fc2884cf0000000000000000000000000b7108E278c2E77E4e4f5c93d9E5e9A11AC837FC000000000000000000000000000000000000000000000000000000174876e800000000000000000000000000000000000000000000000000000000170cdc1e00000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000011c0000000000000000000000000000000000000000000000000000de0000b051208dff5e27ea6b7ac08ebfdf9eb090f32ee9a30fcfc2132d05d31c914a87c6611c10748aeb04b58e8f0024e8eda9df000000000000000000000000c2132d05d31c914a87c6611c10748aeb04b58e8f00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000d15038f8a0362b4ce71d6c879d56bf9fc2884cf000000000000000000000000000000000000000000000000000000000000044d80a06c4eca2760d55f02a771d515e077c9c2403a1ef324885cec1111111254fb6c44bac0bed2854e76f90643097d000000000000000000000000000000000000000000000000000000174876e80000000000cfee7c08";

    uint256 internal constant _BPS = 10000;
    MockCurveLevSwapper5TokensWithBP public swapper;
    MockBorrowStaker public stakerImplementation;
    MockBorrowStaker public staker;
    uint8 public decimalToken = 18;
    uint8 public decimalReward = 6;
    uint256 public rewardAmount = 10**2 * 10**(decimalReward);
    uint256 public maxTokenAmount = 10**15 * 10**decimalToken;
    uint256 public SLIPPAGE_BPS = 9900;

    uint256 public constant DEPOSIT_LENGTH = 2;
    uint256 public constant WITHDRAW_LENGTH = 2;
    uint256 public constant CLAIMABLE_LENGTH = 2;
    uint256 public constant CLAIM_LENGTH = 2;

    function setUp() public override {
        super.setUp();

        _polygon = vm.createFork(vm.envString("ETH_NODE_URI_POLYGON"), 35439623);
        vm.selectFork(_polygon);

        // reset coreBorrow because the `makePersistent()` doens't work on my end
        coreBorrow = new MockCoreBorrow();
        coreBorrow.toggleGuardian(_GUARDIAN);
        coreBorrow.toggleGovernor(_GOVERNOR);

        stakerImplementation = new MockBorrowStaker();
        staker = MockBorrowStaker(
            deployUpgradeable(address(stakerImplementation), abi.encodeWithSelector(staker.setAsset.selector, asset))
        );
        staker.initialize(coreBorrow);

        swapper = new MockCurveLevSwapper5TokensWithBP(
            coreBorrow,
            _UNI_V3_ROUTER,
            _ONE_INCH,
            _ANGLE_ROUTER,
            IBorrowStaker(address(staker))
        );

        assertEq(staker.name(), "Angle Curve USD-BTC-ETH Staker");
        assertEq(staker.symbol(), "agstk-crvUSDBTCETH");
        assertEq(staker.decimals(), 18);

        vm.startPrank(_GOVERNOR);
        IERC20[] memory tokens = new IERC20[](10);
        address[] memory spenders = new address[](10);
        uint256[] memory amounts = new uint256[](10);
        tokens[0] = _USDC;
        tokens[1] = _USDT;
        tokens[2] = _DAI;
        tokens[3] = _amUSDC;
        tokens[4] = _amDAI;
        tokens[5] = _amUSDT;
        tokens[6] = _AaveBPToken;
        tokens[7] = _WBTC;
        tokens[8] = _WETH;
        tokens[9] = asset;
        spenders[0] = _ONE_INCH;
        spenders[1] = _ONE_INCH;
        spenders[2] = _ONE_INCH;
        spenders[3] = address(_AAVE_BPPOOL);
        spenders[4] = address(_AAVE_BPPOOL);
        spenders[5] = address(_AAVE_BPPOOL);
        spenders[6] = address(_METAPOOL);
        spenders[7] = address(_METAPOOL);
        spenders[8] = address(_METAPOOL);
        spenders[9] = address(staker);
        amounts[0] = type(uint256).max;
        amounts[1] = type(uint256).max;
        amounts[2] = type(uint256).max;
        amounts[3] = type(uint256).max;
        amounts[4] = type(uint256).max;
        amounts[5] = type(uint256).max;
        amounts[6] = type(uint256).max;
        amounts[7] = type(uint256).max;
        amounts[8] = type(uint256).max;
        amounts[9] = type(uint256).max;
        swapper.changeAllowance(tokens, spenders, amounts);
        vm.stopPrank();

        vm.startPrank(_alice);
        _USDC.approve(address(swapper), type(uint256).max);
        _USDT.safeIncreaseAllowance(address(swapper), type(uint256).max);
        _DAI.approve(address(swapper), type(uint256).max);
        _amUSDC.safeApprove(address(swapper), type(uint256).max);
        _amUSDT.safeApprove(address(swapper), type(uint256).max);
        _amDAI.safeApprove(address(swapper), type(uint256).max);
        _amWBTC.safeApprove(address(swapper), type(uint256).max);
        _amWETH.safeApprove(address(swapper), type(uint256).max);
        _WBTC.safeApprove(address(swapper), type(uint256).max);
        _WETH.safeApprove(address(swapper), type(uint256).max);
        vm.stopPrank();
    }

    function testLeverageNoAaveTokensSuccess(uint256[3] memory amounts) public {
        amounts[0] = bound(amounts[0], 10**9, 10**25);
        amounts[1] = bound(amounts[1], 10**8, 10**11);
        amounts[2] = bound(amounts[2], 10**18, 10**21);

        deal(address(_AaveBPToken), address(_alice), amounts[0]);
        deal(address(_WBTC), address(_alice), amounts[1]);
        deal(address(_WETH), address(_alice), amounts[2]);

        vm.startPrank(_alice);
        // intermediary variables
        bytes[] memory oneInchData = new bytes[](0);
        uint256 minAmountOut;
        {
            minAmountOut =
                (ITricrypto3(address(_METAPOOL)).calc_token_amount([0, 0, 0, amounts[1], amounts[2]], true) *
                    SLIPPAGE_BPS) /
                _BPS;
        }

        bytes memory addData = abi.encode(false);
        bytes memory swapData = abi.encode(oneInchData, addData);
        bytes memory leverageData = abi.encode(true, _alice, swapData);
        bytes memory data = abi.encode(address(0), 0, SwapType.Leverage, leverageData);

        // we first need to send the tokens before hand, you should always use the swapper
        // in another tx to not losse your funds by front running
        // _AaveBPToken.safeTransfer(address(swapper), amounts[0]);
        _WBTC.safeTransfer(address(swapper), amounts[1]);
        _WETH.safeTransfer(address(swapper), amounts[2]);
        vm.warp(block.timestamp + 10);
        vm.roll(block.number + 1);
        swapper.swap(IERC20(address(_amWBTC)), IERC20(address(staker)), _alice, 0, amounts[1], data);

        vm.stopPrank();

        assertGt(staker.balanceOf(_alice), minAmountOut);
        assertGt(asset.balanceOf(address(staker)), minAmountOut);
        assertEq(staker.balanceOf(_alice), staker.totalSupply());
        assertEq(asset.balanceOf(_alice), 0);
        assertEq(staker.balanceOf(address(swapper)), 0);
        assertEq(asset.balanceOf(address(swapper)), 0);
        assertEq(_DAI.balanceOf(_alice), 0);
        assertEq(_USDT.balanceOf(_alice), 0);
        assertEq(_DAI.balanceOf(address(swapper)), 0);
        assertEq(_USDT.balanceOf(address(swapper)), 0);
        assertEq(_DAI.balanceOf(address(staker)), 0);
        assertEq(_USDT.balanceOf(address(staker)), 0);
    }
}
