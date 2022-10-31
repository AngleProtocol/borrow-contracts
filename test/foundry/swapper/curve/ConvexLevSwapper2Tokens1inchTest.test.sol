// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.12;

import "@openzeppelin/contracts-upgradeable/interfaces/IERC20MetadataUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import "../../BaseTest.test.sol";
import "../../../../contracts/interfaces/IBorrowStaker.sol";
import "../../../../contracts/interfaces/ICoreBorrow.sol";
import "../../../../contracts/interfaces/external/curve/IMetaPool2.sol";
import "../../../../contracts/interfaces/coreModule/IStableMaster.sol";
import "../../../../contracts/interfaces/coreModule/IPoolManager.sol";
import "../../../../contracts/mock/MockTokenPermit.sol";
import { CurveRemovalType, SwapType, BaseLevSwapper, MockConvexLevSwapper2Tokens, SwapperSidechain, IUniswapV3Router, IAngleRouterSidechain } from "../../../../contracts/mock/MockConvexLevSwapper2Tokens.sol";
import { MockBorrowStaker } from "../../../../contracts/mock/MockBorrowStaker.sol";

contract ConvexLevSwapper2Tokens1InchTest is BaseTest {
    using stdStorage for StdStorage;
    using SafeERC20 for IERC20;

    address internal constant _ONE_INCH = 0x1111111254fb6c44bAC0beD2854e76F90643097d;
    IUniswapV3Router internal constant _UNI_V3_ROUTER = IUniswapV3Router(0xE592427A0AEce92De3Edee1F18E0157C05861564);
    IAngleRouterSidechain internal constant _ANGLE_ROUTER =
        IAngleRouterSidechain(address(uint160(uint256(keccak256(abi.encodePacked("_fakeAngleRouter"))))));
    IERC20 public asset = IERC20(0x3175Df0976dFA876431C2E9eE6Bc45b65d3473CC);
    IERC20 internal constant _USDC = IERC20(0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48);
    IERC20 internal constant _USDT = IERC20(0xdAC17F958D2ee523a2206206994597C13D831ec7);
    IERC20 internal constant _FRAX = IERC20(0x853d955aCEf822Db058eb8505911ED77F175b99e);
    uint256 internal constant _DECIMAL_NORM_USDC = 10**12;
    uint256 internal constant _DECIMAL_NORM_USDT = 10**12;

    IMetaPool2 internal constant _METAPOOL = IMetaPool2(0xDcEF968d416a41Cdac0ED8702fAC8128A64241A2);

    uint256 internal constant _BPS = 10000;
    MockConvexLevSwapper2Tokens public swapper;
    MockBorrowStaker public stakerImplementation;
    MockBorrowStaker public staker;
    uint8 public decimalToken = 18;
    uint8 public decimalReward = 6;
    uint256 public rewardAmount = 10**2 * 10**(decimalReward);
    uint256 public maxTokenAmount = 10**15 * 10**decimalToken;
    uint256 public SLIPPAGE_BPS = 9900;

    uint256 public constant DEPOSIT_LENGTH = 10;
    uint256 public constant WITHDRAW_LENGTH = 10;
    uint256 public constant CLAIMABLE_LENGTH = 50;
    uint256 public constant CLAIM_LENGTH = 50;

    function setUp() public override {
        super.setUp();

        _ethereum = vm.createFork(vm.envString("ETH_NODE_URI_MAINNET"), 15824909);
        vm.selectFork(_ethereum);

        // reset coreBorrow because the `makePersistent()` doens't work on my end
        coreBorrow = new MockCoreBorrow();
        coreBorrow.toggleGuardian(_GUARDIAN);
        coreBorrow.toggleGovernor(_GOVERNOR);

        stakerImplementation = new MockBorrowStaker();
        staker = MockBorrowStaker(
            deployUpgradeable(
                address(stakerImplementation),
                abi.encodeWithSelector(staker.initialize.selector, coreBorrow, asset)
            )
        );

        swapper = new MockConvexLevSwapper2Tokens(
            coreBorrow,
            _UNI_V3_ROUTER,
            _ONE_INCH,
            _ANGLE_ROUTER,
            IBorrowStaker(address(staker))
        );

        assertEq(staker.name(), "Angle Curve.fi FRAX/USDC Staker");
        assertEq(staker.symbol(), "agstk-crvFRAX");
        assertEq(staker.decimals(), 18);

        vm.startPrank(_GOVERNOR);
        IERC20[] memory tokens = new IERC20[](6);
        address[] memory spenders = new address[](6);
        uint256[] memory amounts = new uint256[](6);
        tokens[0] = _USDC;
        tokens[1] = _USDT;
        tokens[2] = _FRAX;
        tokens[3] = _USDC;
        tokens[4] = _FRAX;
        tokens[5] = asset;
        spenders[0] = _ONE_INCH;
        spenders[1] = _ONE_INCH;
        spenders[2] = _ONE_INCH;
        spenders[3] = address(_METAPOOL);
        spenders[4] = address(_METAPOOL);
        spenders[5] = address(staker);
        amounts[0] = type(uint256).max;
        amounts[1] = type(uint256).max;
        amounts[2] = type(uint256).max;
        amounts[3] = type(uint256).max;
        amounts[4] = type(uint256).max;
        amounts[5] = type(uint256).max;
        swapper.changeAllowance(tokens, spenders, amounts);
        vm.stopPrank();

        vm.startPrank(_alice);
        _USDC.approve(address(swapper), type(uint256).max);
        _USDT.safeIncreaseAllowance(address(swapper), type(uint256).max);
        _FRAX.approve(address(swapper), type(uint256).max);
        vm.stopPrank();
    }

    function testRevertSlippageNoDeleverage1Inch(
        uint256 addLiquidityUSDC,
        uint256 addLiquidityFRAX,
        uint256 swapAmount,
        uint256 coinSwap
    ) public {
        uint256 swappedFRAX = 10000 ether;
        uint256 swappedUSDT = 10000 * 10**6;
        addLiquidityUSDC = bound(addLiquidityUSDC, 0, 10**15);
        addLiquidityFRAX = bound(addLiquidityFRAX, 0, 10**27);

        deal(address(_USDC), address(_alice), addLiquidityUSDC);
        deal(address(_USDT), address(_alice), swappedUSDT);
        deal(address(_FRAX), address(_alice), swappedFRAX + addLiquidityFRAX);
        vm.startPrank(_alice);

        bytes memory data;
        {
            // intermediary variables
            bytes[] memory oneInchData = new bytes[](2);
            // swap 10000 FRAX for USDC
            oneInchData[0] = abi.encode(
                address(_FRAX),
                0,
                hex"e449022e00000000000000000000000000000000000000000000021e19e0c9bab2400000000000000000000000000000000000000000000000000000000000024dc9bbaa000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000010000000000000000000000009a834b70c07c81a9fcd6f22e842bf002fbffbe4dcfee7c08"
            );
            // swap 10000 USDT for USDC
            oneInchData[1] = abi.encode(
                address(_USDT),
                0,
                hex"e449022e00000000000000000000000000000000000000000000000000000002540be400000000000000000000000000000000000000000000000000000000024e089f88000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000018000000000000000000000003416cf6c708da44db2624d63ea0aaef7113527c6cfee7c08"
            );
            uint256 minAmountOut;
            {
                uint256 lowerBoundSwap = (((addLiquidityUSDC + swappedUSDT + swappedFRAX / _DECIMAL_NORM_USDC) *
                    SLIPPAGE_BPS) / _BPS);
                minAmountOut =
                    (IMetaPool2(address(_METAPOOL)).calc_token_amount([addLiquidityFRAX, lowerBoundSwap], true) *
                        SLIPPAGE_BPS) /
                    _BPS;
            }

            bytes memory addData;
            bytes memory swapData = abi.encode(oneInchData, addData);
            bytes memory leverageData = abi.encode(true, _alice, swapData);
            data = abi.encode(address(0), 0, SwapType.Leverage, leverageData);
        }
        // we first need to send the tokens before hand, you should always use the swapper
        // in another tx to not losse your funds by front running
        _USDC.transfer(address(swapper), addLiquidityUSDC);
        _FRAX.transfer(address(swapper), swappedFRAX + addLiquidityFRAX);
        _USDT.safeTransfer(address(swapper), swappedUSDT);
        swapper.swap(IERC20(address(_USDC)), IERC20(address(staker)), _alice, 0, addLiquidityUSDC, data);

        vm.stopPrank();
        vm.startPrank(_dylan);
        // do a swap to change the pool state and withdraw womething different than what has been deposited
        coinSwap = coinSwap % 2;
        if (coinSwap == 0) {
            swapAmount = bound(swapAmount, 10**18, 10**26);
            deal(address(_FRAX), address(_dylan), swapAmount);
            _FRAX.approve(address(_METAPOOL), type(uint256).max);
        } else {
            swapAmount = bound(swapAmount, 10**6, 10**14);
            deal(address(_USDC), address(_dylan), swapAmount);
            _USDC.approve(address(_METAPOOL), type(uint256).max);
        }
        _METAPOOL.exchange(int128(uint128(coinSwap)), int128(1 - uint128(coinSwap)), swapAmount, 0);

        vm.stopPrank();
        vm.startPrank(_alice);
        // deleverage
        uint256 amount = staker.balanceOf(_alice);
        deal(address(_USDC), address(_alice), 19000 ether / _DECIMAL_NORM_USDC);
        {
            bytes[] memory oneInchData;

            oneInchData = new bytes[](1);
            // swap 19000 USDC for FRAX
            oneInchData[0] = abi.encode(
                address(_USDC),
                ((19000 ether) * _BPS) / SLIPPAGE_BPS,
                hex"e449022e000000000000000000000000000000000000000000000000000000046c7cfe000000000000000000000000000000000000000000000003fbfd1ac7f9631196a0000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000018000000000000000000000009a834b70c07c81a9fcd6f22e842bf002fbffbe4dcfee7c08"
            );
            IERC20[] memory sweepTokens = new IERC20[](2);
            sweepTokens[0] = _FRAX;
            sweepTokens[1] = asset;
            // Do an action that does not exist on the swapper --> keeps the LP tokens as is
            bytes memory fakeData = "0";
            bytes memory removeData = abi.encode(CurveRemovalType.none, fakeData);
            bytes memory swapData = abi.encode(amount, sweepTokens, oneInchData, removeData);
            bytes memory leverageData = abi.encode(false, _alice, swapData);
            data = abi.encode(address(0), 0, SwapType.Leverage, leverageData);
        }
        staker.transfer(address(swapper), amount);
        _USDC.transfer(address(swapper), 19000 ether / _DECIMAL_NORM_USDC);
        vm.expectRevert(SwapperSidechain.TooSmallAmountOut.selector);
        swapper.swap(IERC20(address(staker)), IERC20(address(_USDC)), _alice, 0, amount, data);

        vm.stopPrank();
    }

    function testNoDeleverage1Inch(
        uint256 addLiquidityUSDC,
        uint256 addLiquidityFRAX,
        uint256 swapAmount,
        uint256 coinSwap
    ) public {
        uint256 swappedFRAX = 10000 ether;
        uint256 swappedUSDT = 10000 * 10**6;
        addLiquidityUSDC = bound(addLiquidityUSDC, 0, 10**15);
        addLiquidityFRAX = bound(addLiquidityFRAX, 0, 10**27);

        deal(address(_USDC), address(_alice), addLiquidityUSDC);
        deal(address(_USDT), address(_alice), swappedUSDT);
        deal(address(_FRAX), address(_alice), swappedFRAX + addLiquidityFRAX);
        vm.startPrank(_alice);

        bytes memory data;
        {
            // intermediary variables
            bytes[] memory oneInchData = new bytes[](2);
            // swap 10000 FRAX for USDC
            oneInchData[0] = abi.encode(
                address(_FRAX),
                0,
                hex"e449022e00000000000000000000000000000000000000000000021e19e0c9bab2400000000000000000000000000000000000000000000000000000000000024dc9bbaa000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000010000000000000000000000009a834b70c07c81a9fcd6f22e842bf002fbffbe4dcfee7c08"
            );
            // swap 10000 USDT for USDC
            oneInchData[1] = abi.encode(
                address(_USDT),
                0,
                hex"e449022e00000000000000000000000000000000000000000000000000000002540be400000000000000000000000000000000000000000000000000000000024e089f88000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000018000000000000000000000003416cf6c708da44db2624d63ea0aaef7113527c6cfee7c08"
            );
            uint256 minAmountOut;
            {
                uint256 lowerBoundSwap = (((addLiquidityUSDC + swappedUSDT + swappedFRAX / _DECIMAL_NORM_USDC) *
                    SLIPPAGE_BPS) / _BPS);
                minAmountOut =
                    (IMetaPool2(address(_METAPOOL)).calc_token_amount([addLiquidityFRAX, lowerBoundSwap], true) *
                        SLIPPAGE_BPS) /
                    _BPS;
            }

            bytes memory addData;
            bytes memory swapData = abi.encode(oneInchData, addData);
            bytes memory leverageData = abi.encode(true, _alice, swapData);
            data = abi.encode(address(0), 0, SwapType.Leverage, leverageData);
        }
        // we first need to send the tokens before hand, you should always use the swapper
        // in another tx to not losse your funds by front running
        _USDC.transfer(address(swapper), addLiquidityUSDC);
        _FRAX.transfer(address(swapper), swappedFRAX + addLiquidityFRAX);
        _USDT.safeTransfer(address(swapper), swappedUSDT);
        swapper.swap(IERC20(address(_USDC)), IERC20(address(staker)), _alice, 0, addLiquidityUSDC, data);

        vm.stopPrank();
        vm.startPrank(_dylan);
        // do a swap to change the pool state and withdraw womething different than what has been deposited
        coinSwap = coinSwap % 2;
        if (coinSwap == 0) {
            swapAmount = bound(swapAmount, 10**18, 10**26);
            deal(address(_FRAX), address(_dylan), swapAmount);
            _FRAX.approve(address(_METAPOOL), type(uint256).max);
        } else {
            swapAmount = bound(swapAmount, 10**6, 10**14);
            deal(address(_USDC), address(_dylan), swapAmount);
            _USDC.approve(address(_METAPOOL), type(uint256).max);
        }
        _METAPOOL.exchange(int128(uint128(coinSwap)), int128(1 - uint128(coinSwap)), swapAmount, 0);

        vm.stopPrank();
        vm.startPrank(_alice);
        // deleverage
        uint256 amount = staker.balanceOf(_alice);
        deal(address(_USDC), address(_alice), 19000 ether / _DECIMAL_NORM_USDC);
        {
            bytes[] memory oneInchData;

            oneInchData = new bytes[](1);
            // swap 19000 USDC for FRAX
            oneInchData[0] = abi.encode(
                address(_USDC),
                ((19000 ether) * 9900) / _BPS,
                hex"e449022e000000000000000000000000000000000000000000000000000000046c7cfe000000000000000000000000000000000000000000000003fbfd1ac7f9631196a0000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000018000000000000000000000009a834b70c07c81a9fcd6f22e842bf002fbffbe4dcfee7c08"
            );
            IERC20[] memory sweepTokens = new IERC20[](2);
            sweepTokens[0] = _FRAX;
            sweepTokens[1] = asset;
            // Do an action that does not exist on the swapper --> keeps the LP tokens as is
            bytes memory fakeData = "0";
            bytes memory removeData = abi.encode(CurveRemovalType.none, fakeData);
            bytes memory swapData = abi.encode(amount, sweepTokens, oneInchData, removeData);
            bytes memory leverageData = abi.encode(false, _alice, swapData);
            data = abi.encode(address(0), 0, SwapType.Leverage, leverageData);
        }
        staker.transfer(address(swapper), amount);
        _USDC.transfer(address(swapper), 19000 ether / _DECIMAL_NORM_USDC);
        swapper.swap(IERC20(address(staker)), IERC20(address(_USDC)), _alice, 0, amount, data);

        vm.stopPrank();

        assertEq(asset.balanceOf(_alice), amount);
        assertGe(_FRAX.balanceOf(_alice), (19000 ether * 9900) / _BPS);
        assertEq(staker.balanceOf(address(swapper)), 0);
        assertEq(staker.balanceOf(_alice), 0);
        assertEq(_USDC.balanceOf(address(_alice)), 0);
        assertEq(asset.balanceOf(address(swapper)), 0);
        assertEq(asset.balanceOf(address(staker)), 0);
        assertEq(_USDT.balanceOf(_alice), 0);
        assertEq(_USDC.balanceOf(address(swapper)), 0);
        assertEq(_FRAX.balanceOf(address(swapper)), 0);
        assertEq(_USDT.balanceOf(address(swapper)), 0);
        assertEq(_USDC.balanceOf(address(staker)), 0);
        assertEq(_FRAX.balanceOf(address(staker)), 0);
        assertEq(_USDT.balanceOf(address(staker)), 0);
    }

    function testDeleverageOneCoinTokenWithEndSwap(
        uint256 addLiquidityUSDC,
        uint256 addLiquidityFRAX,
        uint256 swapAmount,
        uint256 coinSwap
    ) public {
        uint256 swappedFRAX = 10000 ether;
        uint256 swappedUSDT = 10000 * 10**6;
        addLiquidityUSDC = bound(addLiquidityUSDC, 0, 10**15);
        addLiquidityFRAX = bound(addLiquidityFRAX, 0, 10**27);

        deal(address(_USDC), address(_alice), addLiquidityUSDC);
        deal(address(_USDT), address(_alice), swappedUSDT);
        deal(address(_FRAX), address(_alice), swappedFRAX + addLiquidityFRAX);
        vm.startPrank(_alice);

        bytes memory data;
        {
            // intermediary variables
            bytes[] memory oneInchData = new bytes[](2);
            // swap 10000 FRAX for USDC
            oneInchData[0] = abi.encode(
                address(_FRAX),
                0,
                hex"e449022e00000000000000000000000000000000000000000000021e19e0c9bab2400000000000000000000000000000000000000000000000000000000000024dc9bbaa000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000010000000000000000000000009a834b70c07c81a9fcd6f22e842bf002fbffbe4dcfee7c08"
            );
            // swap 10000 USDT for USDC
            oneInchData[1] = abi.encode(
                address(_USDT),
                0,
                hex"e449022e00000000000000000000000000000000000000000000000000000002540be400000000000000000000000000000000000000000000000000000000024e089f88000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000018000000000000000000000003416cf6c708da44db2624d63ea0aaef7113527c6cfee7c08"
            );
            uint256 minAmountOut;
            {
                uint256 lowerBoundSwap = (((addLiquidityUSDC + swappedUSDT + swappedFRAX / _DECIMAL_NORM_USDC) *
                    SLIPPAGE_BPS) / _BPS);
                minAmountOut =
                    (IMetaPool2(address(_METAPOOL)).calc_token_amount([addLiquidityFRAX, lowerBoundSwap], true) *
                        SLIPPAGE_BPS) /
                    _BPS;
            }

            bytes memory addData;
            bytes memory swapData = abi.encode(oneInchData, addData);
            bytes memory leverageData = abi.encode(true, _alice, swapData);
            data = abi.encode(address(0), 0, SwapType.Leverage, leverageData);
        }
        // we first need to send the tokens before hand, you should always use the swapper
        // in another tx to not losse your funds by front running
        _USDC.transfer(address(swapper), addLiquidityUSDC);
        _FRAX.transfer(address(swapper), swappedFRAX + addLiquidityFRAX);
        _USDT.safeTransfer(address(swapper), swappedUSDT);
        swapper.swap(IERC20(address(_USDC)), IERC20(address(staker)), _alice, 0, addLiquidityUSDC, data);

        vm.stopPrank();
        vm.startPrank(_dylan);
        // do a swap to change the pool state and withdraw womething different than what has been deposited
        coinSwap = coinSwap % 2;
        if (coinSwap == 0) {
            swapAmount = bound(swapAmount, 10**18, 10**26);
            deal(address(_FRAX), address(_dylan), swapAmount);
            _FRAX.approve(address(_METAPOOL), type(uint256).max);
        } else {
            swapAmount = bound(swapAmount, 10**6, 10**14);
            deal(address(_USDC), address(_dylan), swapAmount);
            _USDC.approve(address(_METAPOOL), type(uint256).max);
        }
        _METAPOOL.exchange(int128(uint128(coinSwap)), int128(1 - uint128(coinSwap)), swapAmount, 0);

        vm.stopPrank();
        vm.startPrank(_alice);
        // deleverage
        uint256 amount = staker.balanceOf(_alice);
        uint256 minOneCoin;
        {
            bytes[] memory oneInchData;
            minOneCoin = (_METAPOOL.calc_withdraw_one_coin(amount, 1) * SLIPPAGE_BPS) / _BPS;
            // If there isn't enough to do the swap don't do it
            if (minOneCoin > 19000 * 10**6) {
                oneInchData = new bytes[](1);
                // swap 19000 USDC for FRAX
                oneInchData[0] = abi.encode(
                    address(_USDC),
                    ((19000 ether) * 9900) / _BPS,
                    hex"e449022e000000000000000000000000000000000000000000000000000000046c7cfe000000000000000000000000000000000000000000000003fbfd1ac7f9631196a0000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000018000000000000000000000009a834b70c07c81a9fcd6f22e842bf002fbffbe4dcfee7c08"
                );
            } else {
                oneInchData = new bytes[](0);
            }
            IERC20[] memory sweepTokens = new IERC20[](1);
            sweepTokens[0] = _USDC;
            bytes memory removeData = abi.encode(CurveRemovalType.oneCoin, abi.encode(1, minOneCoin));
            bytes memory swapData = abi.encode(amount, sweepTokens, oneInchData, removeData);
            bytes memory leverageData = abi.encode(false, _alice, swapData);
            data = abi.encode(address(0), minOneCoin, SwapType.Leverage, leverageData);
        }
        staker.transfer(address(swapper), amount);
        swapper.swap(IERC20(address(staker)), IERC20(address(_FRAX)), _alice, 0, amount, data);

        vm.stopPrank();

        if (minOneCoin > 19000 * 10**6) {
            assertGe(_USDC.balanceOf(_alice), minOneCoin - 19000 * 10**6);
            assertGe(_FRAX.balanceOf(_alice), ((19000 ether) * 9900) / _BPS);
        } else {
            assertGe(_USDC.balanceOf(_alice), minOneCoin);
            assertEq(_FRAX.balanceOf(_alice), 0);
        }
        assertEq(staker.balanceOf(address(swapper)), 0);
        assertEq(staker.balanceOf(_alice), 0);
        assertEq(asset.balanceOf(address(_alice)), 0);
        assertEq(asset.balanceOf(address(swapper)), 0);
        assertEq(asset.balanceOf(address(staker)), 0);
        assertEq(_USDT.balanceOf(_alice), 0);
        assertEq(_USDC.balanceOf(address(swapper)), 0);
        assertEq(_FRAX.balanceOf(address(swapper)), 0);
        assertEq(_USDT.balanceOf(address(swapper)), 0);
        assertEq(_USDC.balanceOf(address(staker)), 0);
        assertEq(_FRAX.balanceOf(address(staker)), 0);
        assertEq(_USDT.balanceOf(address(staker)), 0);
    }

    function testDeleverageBalance1Inch(
        uint256 addLiquidityUSDC,
        uint256 addLiquidityFRAX,
        uint256 swapAmount,
        uint256 coinSwap
    ) public {
        uint256 swappedFRAX = 10000 ether;
        uint256 swappedUSDT = 10000 * 10**6;
        addLiquidityUSDC = bound(addLiquidityUSDC, 0, 10**15);
        addLiquidityFRAX = bound(addLiquidityFRAX, 0, 10**27);

        deal(address(_USDC), address(_alice), addLiquidityUSDC);
        deal(address(_USDT), address(_alice), swappedUSDT);
        deal(address(_FRAX), address(_alice), swappedFRAX + addLiquidityFRAX);
        vm.startPrank(_alice);

        bytes memory data;
        {
            // intermediary variables
            bytes[] memory oneInchData = new bytes[](2);
            // swap 10000 FRAX for USDC
            oneInchData[0] = abi.encode(
                address(_FRAX),
                0,
                hex"e449022e00000000000000000000000000000000000000000000021e19e0c9bab2400000000000000000000000000000000000000000000000000000000000024dc9bbaa000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000010000000000000000000000009a834b70c07c81a9fcd6f22e842bf002fbffbe4dcfee7c08"
            );
            // swap 10000 USDT for USDC
            oneInchData[1] = abi.encode(
                address(_USDT),
                0,
                hex"e449022e00000000000000000000000000000000000000000000000000000002540be400000000000000000000000000000000000000000000000000000000024e089f88000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000018000000000000000000000003416cf6c708da44db2624d63ea0aaef7113527c6cfee7c08"
            );
            uint256 minAmountOut;
            {
                uint256 lowerBoundSwap = (((addLiquidityUSDC + swappedUSDT + swappedFRAX / _DECIMAL_NORM_USDC) *
                    SLIPPAGE_BPS) / _BPS);
                minAmountOut =
                    (IMetaPool2(address(_METAPOOL)).calc_token_amount([addLiquidityFRAX, lowerBoundSwap], true) *
                        SLIPPAGE_BPS) /
                    _BPS;
            }

            bytes memory addData;
            bytes memory swapData = abi.encode(oneInchData, addData);
            bytes memory leverageData = abi.encode(true, _alice, swapData);
            data = abi.encode(address(0), 0, SwapType.Leverage, leverageData);
        }
        // we first need to send the tokens before hand, you should always use the swapper
        // in another tx to not losse your funds by front running
        _USDC.transfer(address(swapper), addLiquidityUSDC);
        _FRAX.transfer(address(swapper), swappedFRAX + addLiquidityFRAX);
        _USDT.safeTransfer(address(swapper), swappedUSDT);
        swapper.swap(IERC20(address(_USDC)), IERC20(address(staker)), _alice, 0, addLiquidityUSDC, data);

        vm.stopPrank();
        vm.startPrank(_dylan);
        // do a swap to change the pool state and withdraw womething different than what has been deposited
        coinSwap = coinSwap % 2;
        if (coinSwap == 0) {
            swapAmount = bound(swapAmount, 10**18, 10**26);
            deal(address(_FRAX), address(_dylan), swapAmount);
            _FRAX.approve(address(_METAPOOL), type(uint256).max);
        } else {
            swapAmount = bound(swapAmount, 10**6, 10**14);
            deal(address(_USDC), address(_dylan), swapAmount);
            _USDC.approve(address(_METAPOOL), type(uint256).max);
        }
        _METAPOOL.exchange(int128(uint128(coinSwap)), int128(1 - uint128(coinSwap)), swapAmount, 0);

        vm.stopPrank();
        vm.startPrank(_alice);
        // deleverage
        uint256 amount = staker.balanceOf(_alice);
        uint256[2] memory minAmounts;
        {
            minAmounts = [
                (_METAPOOL.balances(0) * amount * SLIPPAGE_BPS) / (_BPS * asset.totalSupply()),
                (_METAPOOL.balances(1) * amount * SLIPPAGE_BPS) / (_BPS * asset.totalSupply())
            ];
            bytes[] memory oneInchData;
            // If there isn't enough to do the swap don't do it
            if (minAmounts[1] > 19000 * 10**6) {
                oneInchData = new bytes[](1);
                // swap 19000 USDC for FRAX
                oneInchData[0] = abi.encode(
                    address(_USDC),
                    ((19000 ether) * 9900) / _BPS,
                    hex"e449022e000000000000000000000000000000000000000000000000000000046c7cfe000000000000000000000000000000000000000000000003fbfd1ac7f9631196a0000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000018000000000000000000000009a834b70c07c81a9fcd6f22e842bf002fbffbe4dcfee7c08"
                );
            } else {
                oneInchData = new bytes[](0);
            }
            IERC20[] memory sweepTokens = new IERC20[](1);
            sweepTokens[0] = _USDC;

            bytes memory removeData = abi.encode(CurveRemovalType.balance, abi.encode(minAmounts));
            bytes memory swapData = abi.encode(amount, sweepTokens, oneInchData, removeData);
            bytes memory leverageData = abi.encode(false, _alice, swapData);
            data = abi.encode(address(0), minAmounts[0], SwapType.Leverage, leverageData);
        }
        staker.transfer(address(swapper), amount);
        swapper.swap(IERC20(address(staker)), IERC20(address(_FRAX)), _alice, 0, amount, data);

        vm.stopPrank();

        if (minAmounts[1] > 19000 * 10**6) {
            assertGe(_USDC.balanceOf(_alice), minAmounts[1] - 19000 * 10**6);
            assertGe(_FRAX.balanceOf(_alice), minAmounts[0] + ((19000 ether) * 9900) / _BPS);
        } else {
            assertGe(_USDC.balanceOf(_alice), minAmounts[1]);
            assertGe(_FRAX.balanceOf(_alice), minAmounts[0]);
        }
        assertEq(staker.balanceOf(address(swapper)), 0);
        assertEq(staker.balanceOf(_alice), 0);
        assertEq(asset.balanceOf(address(_alice)), 0);
        assertEq(asset.balanceOf(address(swapper)), 0);
        assertEq(asset.balanceOf(address(staker)), 0);
        assertEq(_USDT.balanceOf(_alice), 0);
        assertEq(_USDC.balanceOf(address(swapper)), 0);
        assertEq(_FRAX.balanceOf(address(swapper)), 0);
        assertEq(_USDT.balanceOf(address(swapper)), 0);
        assertEq(_USDC.balanceOf(address(staker)), 0);
        assertEq(_FRAX.balanceOf(address(staker)), 0);
        assertEq(_USDT.balanceOf(address(staker)), 0);
    }

    function testDeleverageImbalance1Inch(
        uint256 addLiquidityUSDC,
        uint256 addLiquidityFRAX,
        uint256 proportionWithdrawUSDC,
        uint256 swapAmount,
        uint256 coinSwap
    ) public {
        uint256 swappedFRAX = 10000 ether;
        uint256 swappedUSDT = 10000 * 10**6;
        // reduce the amount added to not reach the limits
        addLiquidityUSDC = bound(addLiquidityUSDC, 0, 10**14);
        addLiquidityFRAX = bound(addLiquidityFRAX, 0, 10**26);
        proportionWithdrawUSDC = bound(proportionWithdrawUSDC, 0, 10**9);

        deal(address(_USDC), address(_alice), addLiquidityUSDC);
        deal(address(_USDT), address(_alice), swappedUSDT);
        deal(address(_FRAX), address(_alice), swappedFRAX + addLiquidityFRAX);
        vm.startPrank(_alice);

        bytes memory data;
        {
            // intermediary variables
            bytes[] memory oneInchData = new bytes[](2);
            // swap 10000 FRAX for USDC
            oneInchData[0] = abi.encode(
                address(_FRAX),
                0,
                hex"e449022e00000000000000000000000000000000000000000000021e19e0c9bab2400000000000000000000000000000000000000000000000000000000000024dc9bbaa000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000010000000000000000000000009a834b70c07c81a9fcd6f22e842bf002fbffbe4dcfee7c08"
            );
            // swap 10000 USDT for USDC
            oneInchData[1] = abi.encode(
                address(_USDT),
                0,
                hex"e449022e00000000000000000000000000000000000000000000000000000002540be400000000000000000000000000000000000000000000000000000000024e089f88000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000018000000000000000000000003416cf6c708da44db2624d63ea0aaef7113527c6cfee7c08"
            );
            uint256 minAmountOut;
            {
                uint256 lowerBoundSwap = (((addLiquidityUSDC + swappedUSDT + swappedFRAX / _DECIMAL_NORM_USDC) *
                    SLIPPAGE_BPS) / _BPS);
                minAmountOut =
                    (IMetaPool2(address(_METAPOOL)).calc_token_amount([addLiquidityFRAX, lowerBoundSwap], true) *
                        SLIPPAGE_BPS) /
                    _BPS;
            }

            bytes memory addData;
            bytes memory swapData = abi.encode(oneInchData, addData);
            bytes memory leverageData = abi.encode(true, _alice, swapData);
            data = abi.encode(address(0), 0, SwapType.Leverage, leverageData);
        }
        // we first need to send the tokens before hand, you should always use the swapper
        // in another tx to not losse your funds by front running
        _USDC.transfer(address(swapper), addLiquidityUSDC);
        _FRAX.transfer(address(swapper), swappedFRAX + addLiquidityFRAX);
        _USDT.safeTransfer(address(swapper), swappedUSDT);
        swapper.swap(IERC20(address(_USDC)), IERC20(address(staker)), _alice, 0, addLiquidityUSDC, data);

        vm.stopPrank();
        vm.startPrank(_dylan);
        // do a swap to change the pool state and withdraw womething different than what has been deposited
        coinSwap = coinSwap % 2;
        if (coinSwap == 0) {
            swapAmount = bound(swapAmount, 10**18, 10**26);
            deal(address(_FRAX), address(_dylan), swapAmount);
            _FRAX.approve(address(_METAPOOL), type(uint256).max);
        } else {
            swapAmount = bound(swapAmount, 10**6, 10**14);
            deal(address(_USDC), address(_dylan), swapAmount);
            _USDC.approve(address(_METAPOOL), type(uint256).max);
        }
        _METAPOOL.exchange(int128(uint128(coinSwap)), int128(1 - uint128(coinSwap)), swapAmount, 0);

        vm.stopPrank();
        vm.startPrank(_alice);

        // deleverage
        uint256 amount = staker.balanceOf(_alice);
        uint256[2] memory amountOuts;
        uint256 maxBurnAmount;
        {
            {
                uint256[2] memory minAmounts = [
                    (_METAPOOL.balances(0) * amount) / (asset.totalSupply()),
                    (_METAPOOL.balances(1) * amount) / (asset.totalSupply())
                ];
                // We do as if there were no slippage withdrawing in an imbalance manner vs a balance one and then
                // addd a slippage on the returned amount
                amountOuts = [
                    ((minAmounts[0] + minAmounts[1] * _DECIMAL_NORM_USDC) *
                        (10**9 - proportionWithdrawUSDC) *
                        SLIPPAGE_BPS) / (10**9 * _BPS),
                    ((minAmounts[0] / _DECIMAL_NORM_USDC + minAmounts[1]) * proportionWithdrawUSDC * SLIPPAGE_BPS) /
                        (10**9 * _BPS)
                ];
                // if we try to withdraw more than the curve balances -> rebalance
                uint256 curveBalanceFRAX = _METAPOOL.balances(0);
                uint256 curveBalanceUSDC = _METAPOOL.balances(1);
                if (curveBalanceUSDC < amountOuts[1]) {
                    amountOuts = [
                        ((minAmounts[0] / _DECIMAL_NORM_USDC + minAmounts[1] - curveBalanceUSDC) *
                            _DECIMAL_NORM_USDC *
                            (10**9 - proportionWithdrawUSDC) *
                            SLIPPAGE_BPS) / (10**9 * _BPS),
                        curveBalanceUSDC
                    ];
                } else if (curveBalanceFRAX < amountOuts[0]) {
                    amountOuts = [
                        curveBalanceFRAX,
                        ((minAmounts[0] + minAmounts[1] * _DECIMAL_NORM_USDC - curveBalanceFRAX) *
                            (10**9 - proportionWithdrawUSDC) *
                            SLIPPAGE_BPS) / (10**9 * _BPS * _DECIMAL_NORM_USDC)
                    ];
                }
            }
            maxBurnAmount = IMetaPool2(address(_METAPOOL)).calc_token_amount(amountOuts, false);

            bytes[] memory oneInchData;
            // If there isn't enough to do the swap don't do it
            if (amountOuts[1] > 19000 * 10**6) {
                oneInchData = new bytes[](1);
                // swap 19000 USDC for FRAX
                oneInchData[0] = abi.encode(
                    address(_USDC),
                    ((19000 ether) * 9900) / _BPS,
                    hex"e449022e000000000000000000000000000000000000000000000000000000046c7cfe000000000000000000000000000000000000000000000003fbfd1ac7f9631196a0000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000018000000000000000000000009a834b70c07c81a9fcd6f22e842bf002fbffbe4dcfee7c08"
                );
            } else {
                oneInchData = new bytes[](0);
            }
            IERC20[] memory sweepTokens = new IERC20[](1);
            sweepTokens[0] = _USDC;
            bytes memory removeData = abi.encode(CurveRemovalType.imbalance, abi.encode(_bob, amountOuts));
            bytes memory swapData = abi.encode(amount, sweepTokens, oneInchData, removeData);
            bytes memory leverageData = abi.encode(false, _alice, swapData);
            data = abi.encode(address(0), amountOuts[0], SwapType.Leverage, leverageData);
        }
        staker.transfer(address(swapper), amount);
        swapper.swap(IERC20(address(staker)), IERC20(address(_FRAX)), _alice, 0, amount, data);

        vm.stopPrank();

        if (amountOuts[1] > 19000 * 10**6) {
            assertGe(_USDC.balanceOf(_alice), amountOuts[1] - 19000 * 10**6);
            assertGe(_FRAX.balanceOf(_alice), amountOuts[0] + ((19000 ether) * 9900) / _BPS);
        } else {
            assertGe(_USDC.balanceOf(_alice), amountOuts[1]);
            assertGe(_FRAX.balanceOf(_alice), amountOuts[0]);
        }
        assertLe(staker.balanceOf(_bob), amount - maxBurnAmount);
        assertLe(staker.totalSupply(), amount - maxBurnAmount);
        assertLe(asset.balanceOf(address(staker)), amount - maxBurnAmount);
        assertEq(staker.balanceOf(_alice), 0);
        assertEq(staker.balanceOf(address(swapper)), 0);
        assertEq(asset.balanceOf(address(_alice)), 0);
        assertEq(asset.balanceOf(address(swapper)), 0);
        assertEq(_USDT.balanceOf(_alice), 0);
        assertEq(_USDC.balanceOf(address(swapper)), 0);
        assertEq(_FRAX.balanceOf(address(swapper)), 0);
        assertEq(_USDT.balanceOf(address(swapper)), 0);
        assertEq(_USDC.balanceOf(address(staker)), 0);
        assertEq(_FRAX.balanceOf(address(staker)), 0);
        assertEq(_USDT.balanceOf(address(staker)), 0);
    }
}
