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
import "../../../../contracts/interfaces/coreModule/IStableMaster.sol";
import "../../../../contracts/interfaces/coreModule/IPoolManager.sol";
import "../../../../contracts/mock/MockTokenPermit.sol";
import { CurveRemovalType, SwapType, BaseLevSwapper, MockCurveLevSwapper3TokensWithBP, SwapperSidechain, IUniswapV3Router, IAngleRouterSidechain } from "../../../../contracts/mock/MockCurveLevSwapper3TokensWithBP.sol";
import { MockBorrowStaker } from "../../../../contracts/mock/MockBorrowStaker.sol";

// @dev Testing on Polygon
contract CurveLevSwapper3TokensWithBPBaseTest is BaseTest {
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
    IERC20 internal constant _amUSDC = IERC20(0x1a13F4Ca1d028320A707D99520AbFefca3998b7F);
    IERC20 internal constant _amUSDT = IERC20(0x60D55F02A771d515e077c9C2403a1ef324885CeC);
    IERC20 internal constant _amDAI = IERC20(0x27F8D03b3a2196956ED754baDc28D73be8830A6e);
    IERC20 internal constant _AaveBPToken = IERC20(0xE7a24EF0C5e95Ffb0f6684b813A78F2a3AD7D171);
    IERC20 internal constant _amWBTC = IERC20(0x5c2ed810328349100A66B82b78a1791B101C9D61);
    IERC20 internal constant _amWETH = IERC20(0x28424507fefb6f7f8E9D3860F56504E4e5f5f390);
    uint256 internal constant _DECIMAL_NORM_USDC = 10**12;
    uint256 internal constant _DECIMAL_NORM_USDT = 10**12;
    uint256 internal constant _DECIMAL_NORM_WBTC = 10**10;

    IMetaPool3 internal constant _METAPOOL = IMetaPool3(0x92215849c439E1f8612b6646060B4E3E5ef822cC);
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
    MockCurveLevSwapper3TokensWithBP public swapper;
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

        swapper = new MockCurveLevSwapper3TokensWithBP(
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
        tokens[7] = _amWBTC;
        tokens[8] = _amWETH;
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
        vm.stopPrank();
    }

    function testLeverageNoUnderlyingTokensDeposited(uint256 amount) public {
        amount = bound(amount, 10**20, 10**27);

        _depositDirect(amount);

        assertEq(staker.balanceOf(_alice), amount);
        assertEq(asset.balanceOf(address(staker)), amount);
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

    function testLeverageNoAaveTokensSuccess(uint256[3] memory amounts) public {
        amounts[0] = bound(amounts[0], 10**9, 10**25);
        amounts[1] = bound(amounts[1], 10**8, 10**11);
        amounts[2] = bound(amounts[2], 10**9, 10**21);

        amounts[0] = 0;
        amounts[1] = 0;
        amounts[2] = 10**19;

        deal(address(_AaveBPToken), address(_alice), amounts[0]);
        // deal not working on those tokens
        vm.startPrank(_AAVE_LENDING_POOL);
        // AToken(address(_amWBTC)).mint(address(_alice), amounts[1] * 10, 10);
        AToken(address(_amWETH)).mint(address(_alice), amounts[2] * 10, 10);
        vm.stopPrank();

        vm.startPrank(_alice);
        // intermediary variables
        bytes[] memory oneInchData = new bytes[](0);
        uint256 minAmountOut;
        {
            minAmountOut =
                (IMetaPool3(address(_METAPOOL)).calc_token_amount([amounts[0], amounts[1], amounts[2]], true) *
                    SLIPPAGE_BPS) /
                _BPS;
        }

        bytes memory addData = abi.encode(false);
        bytes memory swapData = abi.encode(oneInchData, addData);
        bytes memory leverageData = abi.encode(true, _alice, swapData);
        bytes memory data = abi.encode(address(0), 0, SwapType.Leverage, leverageData);

        // we first need to send the tokens before hand, you should always use the swapper
        // in another tx to not losse your funds by front running
        _AaveBPToken.safeTransfer(address(swapper), amounts[0]);
        _amWBTC.safeTransfer(address(swapper), amounts[1]);
        _amWETH.safeTransfer(address(swapper), amounts[2]);
        vm.warp(block.timestamp + 10);
        vm.roll(block.number + 1);
        swapper.swap(IERC20(address(_AaveBPToken)), IERC20(address(staker)), _alice, 0, amounts[0], data);

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

    function testLeverageSuccess(uint256[5] memory amounts) public {
        // DAI - USDC - USDT - WBTC - WETH
        amounts[0] = bound(amounts[0], 1, 10**25);
        amounts[1] = bound(amounts[1], 1, 10**13);
        amounts[2] = bound(amounts[2], 1, 10**13);
        amounts[3] = bound(amounts[3], 1000000, 10**11);
        amounts[4] = bound(amounts[4], 1 ether, 10**21);

        uint256 minAmountOut = _depositSwapAndAddLiquidity(amounts, true);

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

    function testNoDepositDeleverageOneCoinToken0(uint256 amount) public {
        amount = bound(amount, 10**20, 10**24);
        uint256 coinIndex = 0;
        IERC20 outToken = IERC20(address(_AaveBPToken));

        _depositDirect(amount);
        uint256 minOneCoin = _deleverageOneCoin(coinIndex, outToken);

        assertEq(_USDC.balanceOf(_alice), 0);
        assertGe(_DAI.balanceOf(_alice), minOneCoin);
        assertEq(staker.balanceOf(address(swapper)), 0);
        assertEq(staker.balanceOf(_alice), 0);
        assertEq(asset.balanceOf(address(_alice)), 0);
        assertEq(asset.balanceOf(address(swapper)), 0);
        assertEq(asset.balanceOf(address(staker)), 0);
        assertEq(_USDT.balanceOf(_alice), 0);
        assertEq(_USDC.balanceOf(address(swapper)), 0);
        assertEq(_DAI.balanceOf(address(swapper)), 0);
        assertEq(_USDT.balanceOf(address(swapper)), 0);
        assertEq(_USDC.balanceOf(address(staker)), 0);
        assertEq(_DAI.balanceOf(address(staker)), 0);
        assertEq(_USDT.balanceOf(address(staker)), 0);
    }

    function testNoDepositDeleverageBalance(uint256 amount, uint256 coinSwap) public {
        amount = bound(amount, 10**20, 10**24);
        _depositDirect(amount);

        vm.startPrank(_alice);
        // deleverage
        amount = staker.balanceOf(_alice);
        uint256[3] memory minAmounts;
        bytes memory data;
        {
            bytes[] memory oneInchData = new bytes[](0);
            IERC20[] memory sweepTokens = new IERC20[](2);
            sweepTokens[0] = _amWBTC;
            sweepTokens[1] = _amWETH;
            minAmounts = [
                (_METAPOOL.balances(0) * amount * SLIPPAGE_BPS) / (_BPS * asset.totalSupply()),
                (_METAPOOL.balances(1) * amount * SLIPPAGE_BPS) / (_BPS * asset.totalSupply()),
                (_METAPOOL.balances(2) * amount * SLIPPAGE_BPS) / (_BPS * asset.totalSupply())
            ];
            bytes memory removeData = abi.encode(CurveRemovalType.balance, false, abi.encode(minAmounts));
            bytes memory swapData = abi.encode(amount, sweepTokens, oneInchData, removeData);
            bytes memory leverageData = abi.encode(false, _alice, swapData);
            data = abi.encode(address(0), minAmounts[1], SwapType.Leverage, leverageData);
        }
        staker.transfer(address(swapper), amount);
        swapper.swap(IERC20(address(staker)), IERC20(address(_AaveBPToken)), _alice, 0, amount, data);

        vm.stopPrank();

        assertGe(_USDC.balanceOf(_alice), minAmounts[1]);
        assertGe(_DAI.balanceOf(_alice), minAmounts[0]);
        assertEq(staker.balanceOf(address(swapper)), 0);
        assertEq(staker.balanceOf(_alice), 0);
        assertEq(asset.balanceOf(address(_alice)), 0);
        assertEq(asset.balanceOf(address(swapper)), 0);
        assertEq(asset.balanceOf(address(staker)), 0);
        assertEq(_USDT.balanceOf(_alice), 0);
        assertEq(_USDC.balanceOf(address(swapper)), 0);
        assertEq(_DAI.balanceOf(address(swapper)), 0);
        assertEq(_USDT.balanceOf(address(swapper)), 0);
        assertEq(_USDC.balanceOf(address(staker)), 0);
        assertEq(_DAI.balanceOf(address(staker)), 0);
        assertEq(_USDT.balanceOf(address(staker)), 0);
    }

    function testDeleverageOneCoinToken2(
        uint256[5] memory amounts,
        uint256 swapAmount,
        uint256 coinSwap
    ) public {
        // DAI - USDC - USDT - WBTC - WETH
        amounts[0] = bound(amounts[0], 1, 10**25);
        amounts[1] = bound(amounts[1], 1, 10**13);
        amounts[2] = bound(amounts[2], 1, 10**13);
        amounts[3] = bound(amounts[3], 1000000, 10**11);
        amounts[4] = bound(amounts[4], 1 ether, 10**21);
        uint256 coinIndex = 0;
        IERC20 outToken = IERC20(address(_AaveBPToken));

        uint256 minAmountOut = _depositSwapAndAddLiquidity(amounts, true);
        _swapToImbalance(1, 2, swapAmount);

        uint256 minOneCoin = _deleverageOneCoin(coinIndex, outToken);

        assertGe(_USDC.balanceOf(_alice), minOneCoin);
        assertEq(_DAI.balanceOf(_alice), 0);
        assertEq(staker.balanceOf(address(swapper)), 0);
        assertEq(staker.balanceOf(_alice), 0);
        assertEq(asset.balanceOf(address(_alice)), 0);
        assertEq(asset.balanceOf(address(swapper)), 0);
        assertEq(asset.balanceOf(address(staker)), 0);
        assertEq(_USDT.balanceOf(_alice), 0);
        assertEq(_USDC.balanceOf(address(swapper)), 0);
        assertEq(_DAI.balanceOf(address(swapper)), 0);
        assertEq(_USDT.balanceOf(address(swapper)), 0);
        assertEq(_USDC.balanceOf(address(staker)), 0);
        assertEq(_DAI.balanceOf(address(staker)), 0);
        assertEq(_USDT.balanceOf(address(staker)), 0);
    }

    // function testDeleverageBalance(
    //     uint256 addLiquidityUSDC,
    //     uint256 addLiquidityFRAX,
    //     uint256 swapAmount,
    //     uint256 coinSwap
    // ) public {
    //     uint256 swappedFRAX = 10000 ether;
    //     uint256 swappedUSDT = 10000 * 10**6;
    //     addLiquidityUSDC = bound(addLiquidityUSDC, 0, 10**15);
    //     addLiquidityFRAX = bound(addLiquidityFRAX, 0, 10**27);

    //     deal(address(_USDC), address(_alice), addLiquidityUSDC);
    //     deal(address(_USDT), address(_alice), swappedUSDT);
    //     deal(address(_DAI), address(_alice), swappedFRAX + addLiquidityFRAX);
    //     vm.startPrank(_alice);

    //     bytes memory data;
    //     {
    //         // intermediary variables
    //         bytes[] memory oneInchData = new bytes[](2);
    //         // swap 10000 FRAX for USDC
    //         oneInchData[0] = abi.encode(
    //             address(_DAI),
    //             0,
    //             hex"e449022e00000000000000000000000000000000000000000000021e19e0c9bab2400000000000000000000000000000000000000000000000000000000000024dc9bbaa000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000010000000000000000000000009a834b70c07c81a9fcd6f22e842bf002fbffbe4dcfee7c08"
    //         );
    //         // swap 10000 USDT for USDC
    //         oneInchData[1] = abi.encode(
    //             address(_USDT),
    //             0,
    //             hex"e449022e00000000000000000000000000000000000000000000000000000002540be400000000000000000000000000000000000000000000000000000000024e089f88000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000018000000000000000000000003416cf6c708da44db2624d63ea0aaef7113527c6cfee7c08"
    //         );
    //         uint256 minAmountOut;
    //         {
    //             uint256 lowerBoundSwap = (((addLiquidityUSDC + swappedUSDT + swappedFRAX / _DECIMAL_NORM_USDC) *
    //                 SLIPPAGE_BPS) / _BPS);
    //             minAmountOut =
    //                 (IMetaPool2(address(_METAPOOL)).calc_token_amount([addLiquidityFRAX, lowerBoundSwap], true) *
    //                     SLIPPAGE_BPS) /
    //                 _BPS;
    //         }

    //         bytes memory addData;
    //         bytes memory swapData = abi.encode(oneInchData, addData);
    //         bytes memory leverageData = abi.encode(true, _alice, swapData);
    //         data = abi.encode(address(0), 0, SwapType.Leverage, leverageData);
    //     }
    //     // we first need to send the tokens before hand, you should always use the swapper
    //     // in another tx to not losse your funds by front running
    //     _USDC.transfer(address(swapper), addLiquidityUSDC);
    //     _DAI.transfer(address(swapper), swappedFRAX + addLiquidityFRAX);
    //     _USDT.safeTransfer(address(swapper), swappedUSDT);
    //     swapper.swap(IERC20(address(_USDC)), IERC20(address(staker)), _alice, 0, addLiquidityUSDC, data);

    //     vm.stopPrank();
    //     vm.startPrank(_dylan);
    //     // do a swap to change the pool state and withdraw womething different than what has been deposited
    //     coinSwap = coinSwap % 2;
    //     if (coinSwap == 0) {
    //         swapAmount = bound(swapAmount, 10**18, 10**26);
    //         deal(address(_DAI), address(_dylan), swapAmount);
    //         _DAI.approve(address(_METAPOOL), type(uint256).max);
    //     } else {
    //         swapAmount = bound(swapAmount, 10**6, 10**14);
    //         deal(address(_USDC), address(_dylan), swapAmount);
    //         _USDC.approve(address(_METAPOOL), type(uint256).max);
    //     }
    //     _METAPOOL.exchange(int128(uint128(coinSwap)), int128(1 - uint128(coinSwap)), swapAmount, 0);

    //     vm.stopPrank();
    //     vm.startPrank(_alice);
    //     // deleverage
    //     uint256 amount = staker.balanceOf(_alice);
    //     uint256[2] memory minAmounts;
    //     {
    //         bytes[] memory oneInchData = new bytes[](0);
    //         IERC20[] memory sweepTokens = new IERC20[](1);
    //         sweepTokens[0] = _USDC;
    //         minAmounts = [
    //             (_METAPOOL.balances(0) * amount * SLIPPAGE_BPS) / (_BPS * asset.totalSupply()),
    //             (_METAPOOL.balances(1) * amount * SLIPPAGE_BPS) / (_BPS * asset.totalSupply())
    //         ];
    //         bytes memory removeData = abi.encode(CurveRemovalType.balance, abi.encode(minAmounts));
    //         bytes memory swapData = abi.encode(amount, sweepTokens, oneInchData, removeData);
    //         bytes memory leverageData = abi.encode(false, _alice, swapData);
    //         data = abi.encode(address(0), minAmounts[0], SwapType.Leverage, leverageData);
    //     }
    //     staker.transfer(address(swapper), amount);
    //     swapper.swap(IERC20(address(staker)), IERC20(address(_DAI)), _alice, 0, amount, data);

    //     vm.stopPrank();

    //     assertGe(_USDC.balanceOf(_alice), minAmounts[1]);
    //     assertGe(_DAI.balanceOf(_alice), minAmounts[0]);
    //     assertEq(staker.balanceOf(address(swapper)), 0);
    //     assertEq(staker.balanceOf(_alice), 0);
    //     assertEq(asset.balanceOf(address(_alice)), 0);
    //     assertEq(asset.balanceOf(address(swapper)), 0);
    //     assertEq(asset.balanceOf(address(staker)), 0);
    //     assertEq(_USDT.balanceOf(_alice), 0);
    //     assertEq(_USDC.balanceOf(address(swapper)), 0);
    //     assertEq(_DAI.balanceOf(address(swapper)), 0);
    //     assertEq(_USDT.balanceOf(address(swapper)), 0);
    //     assertEq(_USDC.balanceOf(address(staker)), 0);
    //     assertEq(_DAI.balanceOf(address(staker)), 0);
    //     assertEq(_USDT.balanceOf(address(staker)), 0);
    // }

    // // remove_liquidity_imbalance doesn't exist on this pool just let it here for future 3 tokens with BP pools
    // function testNoDepositDeleverageImbalance(
    //     uint256 amount,
    //     uint256 proportionWithdrawToken1,
    //     uint256 proportionWithdrawToken2,
    //     uint256 coinSwap,
    //     uint256 swapAmount
    // ) public {
    //     amount = bound(amount, 10**20, 10**24);
    //     proportionWithdrawToken1 = bound(proportionWithdrawToken1, 0, 10**9);
    //     proportionWithdrawToken2 = bound(proportionWithdrawToken2, 0, 10**9 - proportionWithdrawToken1);

    //     _depositDirect(amount);
    //     // _swapToImbalance(1, 2, swapAmount);

    //     vm.startPrank(_alice);
    //     // deleverage
    //     amount = staker.balanceOf(_alice);
    //     uint256[3] memory amountOuts;
    //     uint256 maxBurnAmount;
    //     bytes memory data;
    //     {
    //         {
    //             uint256[3] memory minAmounts = [
    //                 (_METAPOOL.balances(0) * amount) / (asset.totalSupply()),
    //                 (_METAPOOL.balances(1) * amount) / (asset.totalSupply()),
    //                 (_METAPOOL.balances(2) * amount) / (asset.totalSupply())
    //             ];
    //             // We do as if there were no slippage withdrawing in an imbalance manner vs a balance one and then
    //             // addd a slippage on the returned amount
    //             amountOuts = [
    //                 ((minAmounts[0] + minAmounts[1] * _DECIMAL_NORM_WBTC + minAmounts[1]) *
    //                     (10**9 - proportionWithdrawToken1 - proportionWithdrawToken2) *
    //                     SLIPPAGE_BPS) / (10**9 * _BPS),
    //                 ((minAmounts[0] / _DECIMAL_NORM_WBTC + minAmounts[1] + minAmounts[1] / _DECIMAL_NORM_WBTC) *
    //                     proportionWithdrawToken1 *
    //                     SLIPPAGE_BPS) / (10**9 * _BPS),
    //                 ((minAmounts[0] + minAmounts[1] * _DECIMAL_NORM_WBTC + minAmounts[1]) *
    //                     proportionWithdrawToken2 *
    //                     SLIPPAGE_BPS) / (10**9 * _BPS)
    //             ];
    //             // if we try to withdraw more than the curve balances -> rebalance
    //             uint256 curveBalanceAave = _METAPOOL.balances(0);
    //             uint256 curveBalanceWBTC = _METAPOOL.balances(1);
    //             uint256 curveBalanceWETH = _METAPOOL.balances(1);
    //             if (curveBalanceAave < amountOuts[0]) {
    //                 amountOuts[0] = curveBalanceAave**99 / 100;
    //             } else if (curveBalanceWBTC < amountOuts[1]) {
    //                 amountOuts[1] = curveBalanceWBTC**99 / 100;
    //             } else if (curveBalanceWETH < amountOuts[2]) {
    //                 amountOuts[2] = curveBalanceWETH**99 / 100;
    //             }
    //         }
    //         maxBurnAmount = IMetaPool3(address(_METAPOOL)).calc_token_amount(amountOuts, false);

    //         bytes[] memory oneInchData = new bytes[](0);
    //         IERC20[] memory sweepTokens = new IERC20[](2);
    //         sweepTokens[0] = _amWBTC;
    //         sweepTokens[1] = _amWETH;
    //         bytes memory removeData = abi.encode(CurveRemovalType.imbalance, false, abi.encode(_bob, amountOuts));
    //         bytes memory swapData = abi.encode(amount, sweepTokens, oneInchData, removeData);
    //         bytes memory leverageData = abi.encode(false, _alice, swapData);
    //         data = abi.encode(address(0), amountOuts[0], SwapType.Leverage, leverageData);
    //     }
    //     staker.transfer(address(swapper), amount);
    //     swapper.swap(IERC20(address(staker)), IERC20(address(_AaveBPToken)), _alice, 0, amount, data);

    //     vm.stopPrank();

    //     assertGe(_USDC.balanceOf(_alice), amountOuts[1]);
    //     assertGe(_DAI.balanceOf(_alice), amountOuts[0]);
    //     assertLe(staker.balanceOf(_bob), amount - maxBurnAmount);
    //     assertLe(staker.totalSupply(), amount - maxBurnAmount);
    //     assertLe(asset.balanceOf(address(staker)), amount - maxBurnAmount);
    //     assertEq(staker.balanceOf(_alice), 0);
    //     assertEq(staker.balanceOf(address(swapper)), 0);
    //     assertEq(asset.balanceOf(address(_alice)), 0);
    //     assertEq(asset.balanceOf(address(swapper)), 0);
    //     assertEq(_USDT.balanceOf(_alice), 0);
    //     assertEq(_USDC.balanceOf(address(swapper)), 0);
    //     assertEq(_DAI.balanceOf(address(swapper)), 0);
    //     assertEq(_USDT.balanceOf(address(swapper)), 0);
    //     assertEq(_USDC.balanceOf(address(staker)), 0);
    //     assertEq(_DAI.balanceOf(address(staker)), 0);
    //     assertEq(_USDT.balanceOf(address(staker)), 0);
    // }

    // ============================== HELPER FUNCTIONS =============================

    function _depositDirect(uint256 amount) internal {
        deal(address(asset), address(_alice), amount);
        vm.startPrank(_alice);
        // intermediary variables
        bytes memory data;
        {
            bytes[] memory oneInchData = new bytes[](0);

            bytes memory addData = abi.encode(false);
            bytes memory swapData = abi.encode(oneInchData, addData);
            bytes memory leverageData = abi.encode(true, _alice, swapData);
            data = abi.encode(address(0), 0, SwapType.Leverage, leverageData);
        }
        // we first need to send the tokens before hand, you should always use the swapper
        // in another tx to not losse your funds by front running
        asset.transfer(address(swapper), amount);
        swapper.swap(IERC20(address(asset)), IERC20(address(staker)), _alice, 0, amount, data);

        vm.stopPrank();
    }

    function _depositSwapAndAddLiquidity(uint256[5] memory amounts, bool doSwaps)
        internal
        returns (uint256 minAmountOut)
    {
        uint256 swappedDAI = doSwaps ? 100000 ether : 0;
        uint256 swappedUSDT = doSwaps ? 100000 * 10**6 : 0;
        uint256 swappedUSDC = doSwaps ? 100000 * 10**6 : 0;

        deal(address(_USDC), address(_alice), swappedUSDC);
        deal(address(_USDT), address(_alice), swappedUSDT);
        deal(address(_DAI), address(_alice), swappedDAI);
        // deal not working on those tokens
        vm.startPrank(_AAVE_LENDING_POOL);
        AToken(address(_amDAI)).mint(address(_alice), amounts[0] * 10, 10);
        AToken(address(_amUSDC)).mint(address(_alice), amounts[1] * 10, 10);
        AToken(address(_amUSDT)).mint(address(_alice), amounts[2] * 10, 10);
        AToken(address(_amWBTC)).mint(address(_alice), amounts[3] * 10, 10);
        AToken(address(_amWETH)).mint(address(_alice), amounts[4] * 10, 10);
        vm.stopPrank();

        vm.startPrank(_alice);
        // intermediary variables

        bytes[] memory oneInchData;

        if (doSwaps) {
            oneInchData = new bytes[](3);
            // // swap 100000 DAI for amDAI
            oneInchData[0] = abi.encode(address(_DAI), 0, _PAYLOAD_DAI);
            // swap 100000 USDT for amUSDT
            oneInchData[1] = abi.encode(address(_USDT), 0, _PAYLOAD_USDT);
            // swap 100000 USDC for amUSDC
            oneInchData[2] = abi.encode(address(_USDC), 0, _PAYLOAD_USDC);
        } else oneInchData = new bytes[](0);

        {
            uint256 lowerBoundLPBP = (IMetaPool3(address(_AAVE_BPPOOL)).calc_token_amount(
                [
                    (swappedDAI * SLIPPAGE_BPS) / _BPS + amounts[0],
                    (swappedUSDC * SLIPPAGE_BPS) / _BPS + amounts[1],
                    (swappedUSDT * SLIPPAGE_BPS) / _BPS + amounts[2]
                ],
                true
            ) * SLIPPAGE_BPS) / _BPS;
            minAmountOut =
                (IMetaPool3(address(_METAPOOL)).calc_token_amount([lowerBoundLPBP, amounts[3], amounts[4]], true) *
                    SLIPPAGE_BPS) /
                _BPS;
        }

        bytes memory addData = abi.encode(true);
        bytes memory swapData = abi.encode(oneInchData, addData);
        bytes memory leverageData = abi.encode(true, _alice, swapData);
        bytes memory data = abi.encode(address(0), 0, SwapType.Leverage, leverageData);

        // we first need to send the tokens before hand, you should always use the swapper
        // in another tx to not losse your funds by front running
        _DAI.transfer(address(swapper), swappedDAI);
        _USDC.transfer(address(swapper), swappedUSDC);
        _USDT.safeTransfer(address(swapper), swappedUSDT);
        _amDAI.safeTransfer(address(swapper), amounts[0]);
        _amUSDC.safeTransfer(address(swapper), amounts[1]);
        _amUSDT.safeTransfer(address(swapper), amounts[2]);
        _amWBTC.safeTransfer(address(swapper), amounts[3]);
        _amWETH.safeTransfer(address(swapper), amounts[4]);
        swapper.swap(IERC20(address(_USDC)), IERC20(address(staker)), _alice, 0, swappedUSDC, data);

        vm.stopPrank();
    }

    function _deleverageOneCoin(uint256 coinIndex, IERC20 outToken) internal returns (uint256) {
        vm.startPrank(_alice);
        // deleverage
        uint256 amount = staker.balanceOf(_alice);
        uint256 minOneCoin;
        bytes memory data;
        {
            bytes[] memory oneInchData = new bytes[](0);
            IERC20[] memory sweepTokens = new IERC20[](0);
            // sweepTokens[0] = _USDC;
            minOneCoin = (_METAPOOL.calc_withdraw_one_coin(amount, coinIndex) * SLIPPAGE_BPS) / _BPS;
            bytes memory removeData = abi.encode(CurveRemovalType.oneCoin, false, abi.encode(coinIndex, minOneCoin));
            bytes memory swapData = abi.encode(amount, sweepTokens, oneInchData, removeData);
            bytes memory leverageData = abi.encode(false, _alice, swapData);
            data = abi.encode(address(0), minOneCoin, SwapType.Leverage, leverageData);
        }
        staker.transfer(address(swapper), amount);
        swapper.swap(IERC20(address(staker)), outToken, _alice, 0, amount, data);

        vm.stopPrank();

        return minOneCoin;
    }

    function _swapToImbalance(
        uint256 coinSwapFrom,
        uint256 coinSwapTo,
        uint256 swapAmount
    ) internal {
        // do a swap to change the pool state and withdraw womething different than what has been deposited
        coinSwapFrom = coinSwapFrom % 3;
        coinSwapTo = coinSwapTo % 3;
        if (coinSwapFrom == 0) {
            swapAmount = bound(swapAmount, 10**18, 10**23);
            deal(address(_AaveBPToken), address(_alice), swapAmount);
            vm.startPrank(_dylan);
            _AaveBPToken.approve(address(_METAPOOL), type(uint256).max);
        } else if (coinSwapFrom == 1) {
            swapAmount = bound(swapAmount, 10**6, 10**11);
            vm.prank(_AAVE_LENDING_POOL);
            AToken(address(_amWBTC)).mint(address(_dylan), swapAmount * 10, 10);
            vm.startPrank(_dylan);
            IERC20(address(_amWBTC)).approve(address(_METAPOOL), type(uint256).max);
        } else {
            swapAmount = bound(swapAmount, 10**18, 10**22);
            vm.prank(_AAVE_LENDING_POOL);
            AToken(address(_amWETH)).mint(address(_dylan), swapAmount * 10, 10);
            vm.startPrank(_dylan);
            IERC20(address(_amWETH)).approve(address(_METAPOOL), type(uint256).max);
        }
        _METAPOOL.exchange(coinSwapFrom, coinSwapTo, swapAmount, 0);

        vm.stopPrank();
    }
}
