// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.12;

import "@openzeppelin/contracts-upgradeable/interfaces/IERC20MetadataUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import "../BaseTest.test.sol";
import "../../../contracts/interfaces/IBorrowStaker.sol";
import "../../../contracts/interfaces/ICoreBorrow.sol";
import "../../../contracts/mock/MockTokenPermit.sol";
import { SwapType, BaseLevSwapper, MockBaseLevSwapper, IUniswapV3Router, IAngleRouterSidechain } from "../../../contracts/mock/MockBaseLevSwapper.sol";
import { MockBorrowStaker } from "../../../contracts/mock/MockBorrowStaker.sol";

contract BaseLevSwapperTest is BaseTest {
    using stdStorage for StdStorage;
    using SafeERC20 for IERC20;

    IERC20 public asset;
    address internal constant _ONE_INCH = 0x1111111254fb6c44bAC0beD2854e76F90643097d;
    IUniswapV3Router internal constant _UNI_V3_ROUTER = IUniswapV3Router(0xE592427A0AEce92De3Edee1F18E0157C05861564);
    IAngleRouterSidechain internal constant _ANGLE_ROUTER =
        IAngleRouterSidechain(address(uint160(uint256(keccak256(abi.encodePacked("_fakeAngleRouter"))))));
    IERC20 internal constant _USDC = IERC20(0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48);
    IERC20 internal constant _USDT = IERC20(0xdAC17F958D2ee523a2206206994597C13D831ec7);
    IERC20 internal constant _FRAX = IERC20(0x853d955aCEf822Db058eb8505911ED77F175b99e);
    uint256 internal constant _DECIMAL_NORM_USDC = 10**12;
    uint256 internal constant _DECIMAL_NORM_USDT = 10**12;

    uint256 internal constant _BPS = 10000;
    MockBaseLevSwapper public swapper;
    MockBorrowStaker public stakerImplementation;
    MockBorrowStaker public staker;
    uint8 public decimalToken = 18;
    uint8 public decimalReward = 6;
    uint256 public rewardAmount = 10**2 * 10**(decimalReward);
    uint256 public maxTokenAmount = 10**15 * 10**decimalToken;

    uint256 public constant DEPOSIT_LENGTH = 10;
    uint256 public constant WITHDRAW_LENGTH = 10;
    uint256 public constant CLAIMABLE_LENGTH = 50;
    uint256 public constant CLAIM_LENGTH = 50;

    function setUp() public override {
        super.setUp();
    }

    function setUpNoFork() public {
        asset = IERC20(new MockTokenPermit("agEUR", "agEUR", decimalToken));
        stakerImplementation = new MockBorrowStaker();
        staker = MockBorrowStaker(
            deployUpgradeable(
                address(stakerImplementation),
                abi.encodeWithSelector(staker.initialize.selector, coreBorrow, asset)
            )
        );
        swapper = new MockBaseLevSwapper(
            coreBorrow,
            _UNI_V3_ROUTER,
            _ONE_INCH,
            _ANGLE_ROUTER,
            IBorrowStaker(address(staker))
        );
    }

    function setUpForkAndAllowance() public {
        _ethereum = vm.createFork(vm.envString("ETH_NODE_URI_MAINNET"), 15824909);
        vm.selectFork(_ethereum);

        // reset coreBorrow because the `makePersistent()` doens't work on my end
        coreBorrow = new MockCoreBorrow();
        coreBorrow.toggleGuardian(_GUARDIAN);
        coreBorrow.toggleGovernor(_GOVERNOR);

        asset = _USDC;
        stakerImplementation = new MockBorrowStaker();
        staker = MockBorrowStaker(
            deployUpgradeable(
                address(stakerImplementation),
                abi.encodeWithSelector(staker.initialize.selector, coreBorrow, asset)
            )
        );
        swapper = new MockBaseLevSwapper(
            coreBorrow,
            _UNI_V3_ROUTER,
            _ONE_INCH,
            _ANGLE_ROUTER,
            IBorrowStaker(address(staker))
        );

        vm.startPrank(_GOVERNOR);
        IERC20[] memory tokens = new IERC20[](3);
        address[] memory spenders = new address[](3);
        uint256[] memory amounts = new uint256[](3);
        tokens[0] = _USDC;
        tokens[1] = _USDT;
        tokens[2] = _FRAX;
        spenders[0] = _ONE_INCH;
        spenders[1] = _ONE_INCH;
        spenders[2] = _ONE_INCH;
        amounts[0] = type(uint256).max;
        amounts[1] = type(uint256).max;
        amounts[2] = type(uint256).max;
        swapper.changeAllowance(tokens, spenders, amounts);
        vm.stopPrank();

        vm.startPrank(_alice);
        _USDC.approve(address(swapper), type(uint256).max);
        _USDT.safeIncreaseAllowance(address(swapper), type(uint256).max);
        _FRAX.approve(address(swapper), type(uint256).max);
        vm.stopPrank();
    }

    // ================================== NO FORK ==================================

    function testDepositSwapperNo1InchNoEndTransfer(uint256 amount) public {
        setUpNoFork();
        deal(address(asset), address(_alice), amount);
        vm.startPrank(_alice);
        // intermediary variables
        bool leverage = true;
        address stakeFor = _alice;
        bytes[] memory oneInchData = new bytes[](0);
        bytes memory addData;
        bytes memory swapData = abi.encode(oneInchData, addData);
        bytes memory leverageData = abi.encode(leverage, stakeFor, swapData);
        bytes memory data = abi.encode(address(0), 0, SwapType.Leverage, leverageData);

        // we first need to send the tokens before hand, you should always use the swapper
        // in another tx to not losse your funds by front running
        asset.transfer(address(swapper), amount);
        swapper.swap(IERC20(address(asset)), IERC20(address(staker)), _alice, 0, amount, data);

        vm.stopPrank();
        assertEq(staker.balanceOf(_alice), amount);
        assertEq(staker.balanceOf(address(swapper)), 0);
        assertEq(asset.balanceOf(_alice), 0);
        assertEq(asset.balanceOf(address(swapper)), 0);
        assertEq(asset.balanceOf(address(staker)), amount);
    }

    function testWithdrawSwapperNo1InchNoEndTransfer(uint256 amount) public {
        setUpNoFork();

        deal(address(asset), address(_alice), amount);
        vm.startPrank(_alice);
        // intermediary variables
        bool leverage = true;
        address stakeFor = _alice;
        bytes[] memory oneInchData = new bytes[](0);
        bytes memory addData;
        bytes memory swapData = abi.encode(oneInchData, addData);
        bytes memory leverageData = abi.encode(leverage, stakeFor, swapData);
        bytes memory data = abi.encode(address(0), 0, SwapType.Leverage, leverageData);

        // we first need to send the tokens before hand, you should always use the swapper
        // in another tx to not losse your funds by front running
        asset.transfer(address(swapper), amount);
        swapper.swap(IERC20(address(asset)), IERC20(address(staker)), _alice, 0, amount, data);

        // deleverage
        leverage = false;
        stakeFor = _alice;
        IERC20[] memory sweepToken = new IERC20[](0);
        oneInchData;
        addData;
        swapData = abi.encode(sweepToken, oneInchData, addData);
        leverageData = abi.encode(leverage, stakeFor, swapData);
        data = abi.encode(address(0), amount, SwapType.Leverage, leverageData);
        staker.transfer(address(swapper), amount);
        swapper.swap(IERC20(address(staker)), IERC20(address(asset)), _alice, 0, amount, data);

        vm.stopPrank();

        assertEq(asset.balanceOf(_alice), amount);
        assertEq(staker.balanceOf(address(swapper)), 0);
        assertEq(staker.balanceOf(_alice), 0);
        assertEq(asset.balanceOf(address(swapper)), 0);
        assertEq(asset.balanceOf(address(staker)), 0);
    }

    // ==================================== FORK ===================================

    // ================================= SWAP 1INCH ================================
    function testDepositMulti1Inch(uint256 amount) public {
        uint256 amountFRAX = 10000 ether;
        uint256 amountUSDT = 10000 * 10**6;
        amount = bound(amount, 0, 10**15);

        setUpForkAndAllowance();
        deal(address(asset), address(_alice), amount);
        deal(address(_USDT), address(_alice), amountUSDT);
        deal(address(_FRAX), address(_alice), amountFRAX);
        vm.startPrank(_alice);
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
        uint256 minAmountOut = ((amount + amountUSDT + amountFRAX / _DECIMAL_NORM_USDC) * 9900) / _BPS;

        bytes memory addData;
        bytes memory swapData = abi.encode(oneInchData, addData);
        bytes memory leverageData = abi.encode(true, _alice, swapData);
        bytes memory data = abi.encode(address(0), 0, SwapType.Leverage, leverageData);

        // we first need to send the tokens before hand, you should always use the swapper
        // in another tx to not losse your funds by front running
        asset.transfer(address(swapper), amount);
        _FRAX.transfer(address(swapper), amountFRAX);
        _USDT.safeTransfer(address(swapper), amountUSDT);
        swapper.swap(IERC20(address(asset)), IERC20(address(staker)), _alice, 0, amount, data);

        vm.stopPrank();

        assertGt(staker.balanceOf(_alice), minAmountOut);
        assertEq(staker.balanceOf(_alice), staker.totalSupply());
        assertEq(asset.balanceOf(_alice), 0);
        assertEq(staker.balanceOf(address(swapper)), 0);
        assertEq(asset.balanceOf(address(swapper)), 0);
        assertGt(asset.balanceOf(address(staker)), minAmountOut);
        assertEq(_FRAX.balanceOf(_alice), 0);
        assertEq(_USDT.balanceOf(_alice), 0);
        assertEq(_FRAX.balanceOf(address(swapper)), 0);
        assertEq(_USDT.balanceOf(address(swapper)), 0);
        assertEq(_FRAX.balanceOf(address(staker)), 0);
        assertEq(_USDT.balanceOf(address(staker)), 0);
    }

    function testRemoveMulti1Inch(uint256 amount) public {
        uint256 amountFRAX = 10000 ether;
        uint256 amountUSDT = 10000 * 10**6;
        amount = bound(amount, 0, 10**15);

        setUpForkAndAllowance();
        deal(address(asset), address(_alice), amount);
        deal(address(_USDT), address(_alice), amountUSDT);
        deal(address(_FRAX), address(_alice), amountFRAX);
        vm.startPrank(_alice);

        bytes memory data;
        uint256 minAmountOut = ((amount + amountUSDT + amountFRAX / _DECIMAL_NORM_USDC) * 9900) / _BPS;
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

            bytes memory addData;
            bytes memory swapData = abi.encode(oneInchData, addData);
            bytes memory leverageData = abi.encode(true, _alice, swapData);
            data = abi.encode(address(0), 0, SwapType.Leverage, leverageData);
        }
        // we first need to send the tokens before hand, you should always use the swapper
        // in another tx to not losse your funds by front running
        asset.transfer(address(swapper), amount);
        _FRAX.transfer(address(swapper), amountFRAX);
        _USDT.safeTransfer(address(swapper), amountUSDT);
        swapper.swap(IERC20(address(asset)), IERC20(address(staker)), _alice, 0, amount, data);

        console.log("min amount out ", minAmountOut);

        // deleverage
        minAmountOut = (19000 ether * 9900) / _BPS;
        // We sweep the USDC in the staker removal process, because I made a swap of 19000 on 1inch swagger
        // As I can't exactly anticipate the number of USDC after swapping FRAX and USDT
        IERC20[] memory sweepTokens = new IERC20[](1);
        sweepTokens[0] = asset;
        {
            // intermediary variables
            bytes[] memory oneInchData = new bytes[](1);
            // swap 19000 USDC for FRAX
            oneInchData[0] = abi.encode(
                address(_USDC),
                // unecessary to check the slippage as there is the `swap()` check for this one
                0,
                hex"e449022e000000000000000000000000000000000000000000000000000000046c7cfe000000000000000000000000000000000000000000000003fbfd1ac7f9631196a0000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000018000000000000000000000009a834b70c07c81a9fcd6f22e842bf002fbffbe4dcfee7c08"
            );
            bytes memory addData;
            bytes memory swapData = abi.encode(sweepTokens, oneInchData, addData);
            bytes memory leverageData = abi.encode(false, _alice, swapData);
            data = abi.encode(address(0), minAmountOut, SwapType.Leverage, leverageData);
        }
        amount = staker.balanceOf(_alice);
        staker.transfer(address(swapper), amount);
        swapper.swap(IERC20(address(staker)), IERC20(address(_FRAX)), _alice, 0, amount, data);

        vm.stopPrank();

        // because of the sweep
        assertGt(asset.balanceOf(_alice), ((amount - 19000 * 10**6) * 9900) / _BPS);
        assertEq(staker.balanceOf(address(swapper)), 0);
        assertEq(staker.balanceOf(_alice), 0);
        assertEq(asset.balanceOf(address(swapper)), 0);
        assertEq(asset.balanceOf(address(staker)), 0);
        assertGt(_FRAX.balanceOf(_alice), minAmountOut);
        assertEq(_USDT.balanceOf(_alice), 0);
        assertEq(_FRAX.balanceOf(address(swapper)), 0);
        assertEq(_USDT.balanceOf(address(swapper)), 0);
    }

    function testRemoveSendToMulti1Inch(uint256 amount) public {
        uint256 amountFRAX = 10000 ether;
        uint256 amountUSDT = 10000 * 10**6;
        amount = bound(amount, 0, 10**15);

        setUpForkAndAllowance();
        deal(address(asset), address(_alice), amount);
        deal(address(_USDT), address(_alice), amountUSDT);
        deal(address(_FRAX), address(_alice), amountFRAX);
        vm.startPrank(_alice);

        bytes memory data;
        uint256 minAmountOut = ((amount + amountUSDT + amountFRAX / _DECIMAL_NORM_USDC) * 9900) / _BPS;
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

            bytes memory addData;
            bytes memory swapData = abi.encode(oneInchData, addData);
            bytes memory leverageData = abi.encode(true, _alice, swapData);
            data = abi.encode(address(0), 0, SwapType.Leverage, leverageData);
        }
        // we first need to send the tokens before hand, you should always use the swapper
        // in another tx to not losse your funds by front running
        asset.transfer(address(swapper), amount);
        _FRAX.transfer(address(swapper), amountFRAX);
        _USDT.safeTransfer(address(swapper), amountUSDT);
        swapper.swap(IERC20(address(asset)), IERC20(address(staker)), _alice, 0, amount, data);

        // deleverage
        minAmountOut = (19000 ether * 9900) / _BPS;
        // We sweep the USDC in the staker removal process, because I made a swap of 19000 on 1inch swagger
        // As I can't exactly anticipate the number of USDC after swapping FRAX and USDT
        IERC20[] memory sweepTokens = new IERC20[](1);
        sweepTokens[0] = asset;
        {
            // intermediary variables
            bytes[] memory oneInchData = new bytes[](1);
            // swap 19000 USDC for FRAX
            oneInchData[0] = abi.encode(
                address(_USDC),
                minAmountOut,
                hex"e449022e000000000000000000000000000000000000000000000000000000046c7cfe000000000000000000000000000000000000000000000003fbfd1ac7f9631196a0000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000018000000000000000000000009a834b70c07c81a9fcd6f22e842bf002fbffbe4dcfee7c08"
            );
            bytes memory addData;
            bytes memory swapData = abi.encode(sweepTokens, oneInchData, addData);
            bytes memory leverageData = abi.encode(false, _bob, swapData);
            data = abi.encode(address(0), minAmountOut, SwapType.Leverage, leverageData);
        }
        amount = staker.balanceOf(_alice);
        staker.transfer(address(swapper), amount);
        swapper.swap(IERC20(address(staker)), IERC20(address(_FRAX)), _charlie, 0, amount, data);

        vm.stopPrank();

        // because of the sweep
        assertGt(asset.balanceOf(_bob), ((amount - 19000 * 10**6) * 9900) / _BPS);
        assertEq(asset.balanceOf(_alice), 0);
        assertEq(staker.balanceOf(address(swapper)), 0);
        assertEq(staker.balanceOf(_alice), 0);
        assertEq(asset.balanceOf(address(swapper)), 0);
        assertEq(asset.balanceOf(address(staker)), 0);
        assertGt(_FRAX.balanceOf(_charlie), minAmountOut);
        assertEq(_FRAX.balanceOf(_alice), 0);
        assertEq(_USDT.balanceOf(_alice), 0);
        assertEq(_FRAX.balanceOf(address(swapper)), 0);
        assertEq(_USDT.balanceOf(address(swapper)), 0);
    }
}
