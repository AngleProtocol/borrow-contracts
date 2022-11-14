// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.12;

import "@openzeppelin/contracts-upgradeable/interfaces/IERC20MetadataUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import "../../BaseTest.test.sol";
import { AToken } from "../../../../contracts/interfaces/external/aave/AToken.sol";
import { ILendingPool } from "../../../../contracts/interfaces/external/aave/ILendingPool.sol";
import "../../../../contracts/interfaces/IBorrowStaker.sol";
import "../../../../contracts/interfaces/ICoreBorrow.sol";
import "../../../../contracts/interfaces/external/curve/IMetaPool3.sol";
import "../../../../contracts/interfaces/coreModule/IStableMaster.sol";
import "../../../../contracts/interfaces/coreModule/IPoolManager.sol";
import "../../../../contracts/mock/MockTokenPermit.sol";
import { CurveRemovalType, SwapType, BaseLevSwapper, MockCurveLevSwapper3Tokens, SwapperSidechain, IUniswapV3Router, IAngleRouterSidechain } from "../../../../contracts/mock/MockCurveLevSwapper3Tokens.sol";
import { MockBorrowStaker } from "../../../../contracts/mock/MockBorrowStaker.sol";

// @dev Testing on Polygon
contract CurveLevSwapper3TokensTest is BaseTest {
    using stdStorage for StdStorage;
    using SafeERC20 for IERC20;

    address internal constant _ONE_INCH = 0x1111111254fb6c44bAC0beD2854e76F90643097d;
    IUniswapV3Router internal constant _UNI_V3_ROUTER = IUniswapV3Router(0xE592427A0AEce92De3Edee1F18E0157C05861564);
    IAngleRouterSidechain internal constant _ANGLE_ROUTER =
        IAngleRouterSidechain(address(uint160(uint256(keccak256(abi.encodePacked("_fakeAngleRouter"))))));
    IERC20 public asset = IERC20(0xE7a24EF0C5e95Ffb0f6684b813A78F2a3AD7D171);
    IERC20 internal constant _USDC = IERC20(0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174);
    IERC20 internal constant _USDT = IERC20(0xc2132D05D31c914a87C6611C10748AEb04B58e8F);
    IERC20 internal constant _DAI = IERC20(0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063);
    IERC20 internal constant _amUSDC = IERC20(0x1a13F4Ca1d028320A707D99520AbFefca3998b7F);
    IERC20 internal constant _amUSDT = IERC20(0x60D55F02A771d515e077c9C2403a1ef324885CeC);
    IERC20 internal constant _amDAI = IERC20(0x27F8D03b3a2196956ED754baDc28D73be8830A6e);
    uint256 internal constant _DECIMAL_NORM_USDC = 10**12;
    uint256 internal constant _DECIMAL_NORM_USDT = 10**12;

    IMetaPool3 internal constant _METAPOOL = IMetaPool3(0x445FE580eF8d70FF569aB36e80c647af338db351);
    ILendingPool internal constant _AAVE_LENDING_POOL = ILendingPool(0x8dFf5E27EA6b7AC08EbFdf9eB090F32ee9a30fcf);

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
    MockCurveLevSwapper3Tokens public swapper;
    MockBorrowStaker public stakerImplementation;
    MockBorrowStaker public staker;
    uint8 public decimalToken = 18;
    uint8 public decimalReward = 6;
    uint256 public rewardAmount = 10**2 * 10**(decimalReward);
    uint256 public maxTokenAmount = 10**15 * 10**decimalToken;
    uint256 public SLIPPAGE_BPS = 9800;

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

        swapper = new MockCurveLevSwapper3Tokens(
            coreBorrow,
            _UNI_V3_ROUTER,
            _ONE_INCH,
            _ANGLE_ROUTER,
            IBorrowStaker(address(staker))
        );

        assertEq(staker.name(), "Angle Curve.fi amDAI/amUSDC/amUSDT Staker");
        assertEq(staker.symbol(), "agstk-am3CRV");
        assertEq(staker.decimals(), 18);

        vm.startPrank(_GOVERNOR);
        IERC20[] memory tokens = new IERC20[](7);
        address[] memory spenders = new address[](7);
        uint256[] memory amounts = new uint256[](7);
        tokens[0] = _USDC;
        tokens[1] = _USDT;
        tokens[2] = _DAI;
        tokens[3] = _amUSDC;
        tokens[4] = _amDAI;
        tokens[5] = _amUSDT;
        tokens[6] = asset;
        spenders[0] = _ONE_INCH;
        spenders[1] = _ONE_INCH;
        spenders[2] = _ONE_INCH;
        spenders[3] = address(_METAPOOL);
        spenders[4] = address(_METAPOOL);
        spenders[5] = address(_METAPOOL);
        spenders[6] = address(staker);
        amounts[0] = type(uint256).max;
        amounts[1] = type(uint256).max;
        amounts[2] = type(uint256).max;
        amounts[3] = type(uint256).max;
        amounts[4] = type(uint256).max;
        amounts[5] = type(uint256).max;
        amounts[6] = type(uint256).max;
        swapper.changeAllowance(tokens, spenders, amounts);
        vm.stopPrank();

        vm.startPrank(_alice);
        _USDC.approve(address(swapper), type(uint256).max);
        _USDT.safeIncreaseAllowance(address(swapper), type(uint256).max);
        _DAI.approve(address(swapper), type(uint256).max);
        _USDC.approve(address(_AAVE_LENDING_POOL), type(uint256).max);
        _USDT.safeIncreaseAllowance(address(_AAVE_LENDING_POOL), type(uint256).max);
        _DAI.approve(address(_AAVE_LENDING_POOL), type(uint256).max);
        _amUSDC.safeApprove(address(swapper), type(uint256).max);
        _amUSDT.safeApprove(address(swapper), type(uint256).max);
        _amDAI.safeApprove(address(swapper), type(uint256).max);
        vm.stopPrank();

        vm.startPrank(_dylan);
        _DAI.approve(address(_AAVE_LENDING_POOL), type(uint256).max);
        _USDC.approve(address(_AAVE_LENDING_POOL), type(uint256).max);
        _USDT.safeIncreaseAllowance(address(_AAVE_LENDING_POOL), type(uint256).max);
        vm.stopPrank();
    }

    function testLeverageNoUnderlyingTokensDeposited(uint256 amount) public {
        amount = bound(amount, 0, 10**27);

        _depositDirect(amount);

        assertEq(staker.balanceOf(_alice), amount);
        assertEq(asset.balanceOf(address(staker)), amount);
        assertEq(staker.balanceOf(_alice), staker.totalSupply());
        _assertCommonLeverage();
    }

    function testLeverageSuccess(uint256[3] memory amounts) public {
        uint256 minAmountOut = _depositSwapAndAddLiquidity(amounts, true);

        assertGt(staker.balanceOf(_alice), minAmountOut);
        assertGt(asset.balanceOf(address(staker)), minAmountOut);
        assertEq(staker.balanceOf(_alice), staker.totalSupply());
        _assertCommonLeverage();
    }

    function testNoDepositDeleverageOneCoinToken1(uint256 amount) public {
        amount = bound(amount, 10**20, 10**24);
        int128 coinIndex = 1;
        IERC20 outToken = IERC20(address(_amUSDC));

        _depositDirect(amount);
        uint256 minOneCoin = _deleverageOneCoin(coinIndex, outToken);

        assertGe(_amUSDC.balanceOf(_alice), minOneCoin);
        assertEq(_amUSDT.balanceOf(_alice), 0);
        assertEq(_amDAI.balanceOf(_alice), 0);
        _assertCommonDeleverage();
    }

    function testNoDepositDeleverageBalance(uint256 amount) public {
        amount = bound(amount, 10**20, 10**24);
        _depositDirect(amount);
        uint256[3] memory minAmounts = _deleverageBalance();

        assertGe(_amDAI.balanceOf(_alice), minAmounts[0]);
        assertGe(_amUSDC.balanceOf(_alice), minAmounts[1]);
        assertGe(_amUSDT.balanceOf(_alice), minAmounts[2]);
        _assertCommonDeleverage();
    }

    function testDeleverageOneCoinToken2(
        uint256[3] memory amounts,
        uint256 swapAmount,
        int128 coinSwapFrom,
        int128 coinSwapTo
    ) public {
        _depositSwapAndAddLiquidity(amounts, true);

        coinSwapFrom = int128(uint128(bound(uint256(uint128(coinSwapFrom)), 0, 2)));
        coinSwapTo = int128(uint128(bound(uint256(uint128(coinSwapTo)), 0, 2)));

        if (coinSwapTo == coinSwapFrom && coinSwapTo < 2) coinSwapTo += 1;
        else if (coinSwapTo == coinSwapFrom) coinSwapTo -= 1;

        _swapToImbalance(coinSwapFrom, coinSwapTo, swapAmount);

        int128 coinIndex = 1;
        IERC20 outToken = IERC20(address(_amUSDC));

        uint256 minOneCoin = _deleverageOneCoin(coinIndex, outToken);

        assertGe(_amUSDC.balanceOf(_alice), minOneCoin);
        assertGe(_amDAI.balanceOf(_alice), 0);
        assertGe(_amUSDT.balanceOf(_alice), 0);
        _assertCommonDeleverage();
    }

    function testDeleverageBalance(
        uint256[3] memory amounts,
        int128 coinSwapFrom,
        int128 coinSwapTo
    ) public {
        _depositSwapAndAddLiquidity(amounts, true);

        coinSwapFrom = int128(uint128(bound(uint256(uint128(coinSwapFrom)), 0, 2)));
        coinSwapTo = int128(uint128(bound(uint256(uint128(coinSwapTo)), 0, 2)));

        if (coinSwapTo == coinSwapFrom && coinSwapTo < 2) coinSwapTo += 1;
        else if (coinSwapTo == coinSwapFrom) coinSwapTo -= 1;

        uint256[3] memory minAmounts = _deleverageBalance();

        assertGe(_amDAI.balanceOf(_alice), minAmounts[0]);
        assertGe(_amUSDC.balanceOf(_alice), minAmounts[1]);
        assertGe(_amUSDT.balanceOf(_alice), minAmounts[2]);
        _assertCommonDeleverage();
    }

    function testDeleverageImbalance(
        uint256[3] memory amounts,
        int128 coinSwapFrom,
        int128 coinSwapTo,
        uint256 proportionWithdrawToken1,
        uint256 proportionWithdrawToken2
    ) public {
        proportionWithdrawToken1 = bound(proportionWithdrawToken1, 0, 10**9);
        proportionWithdrawToken2 = bound(proportionWithdrawToken2, 0, 10**9 - proportionWithdrawToken1);

        _depositSwapAndAddLiquidity(amounts, true);

        coinSwapFrom = int128(uint128(bound(uint256(uint128(coinSwapFrom)), 0, 2)));
        coinSwapTo = int128(uint128(bound(uint256(uint128(coinSwapTo)), 0, 2)));

        if (coinSwapTo == coinSwapFrom && coinSwapTo < 2) coinSwapTo += 1;
        else if (coinSwapTo == coinSwapFrom) coinSwapTo -= 1;

        (uint256[3] memory amountOut, uint256 keptLPToken) = _deleverageImbalance(
            proportionWithdrawToken1,
            proportionWithdrawToken2
        );

        // Aave balances have rounding issues as they are corrected by an index
        assertApproxEqAbs(_amDAI.balanceOf(_alice), amountOut[0], 5 wei);
        assertApproxEqAbs(_amUSDC.balanceOf(_alice), amountOut[1], 5 wei);
        assertApproxEqAbs(_amUSDT.balanceOf(_alice), amountOut[2], 5 wei);
        assertEq(_amDAI.balanceOf(_bob), 0);
        assertEq(_amUSDC.balanceOf(_bob), 0);
        assertEq(_amUSDT.balanceOf(_bob), 0);
        assertLe(staker.balanceOf(_bob), keptLPToken);
        assertLe(staker.totalSupply(), keptLPToken);
        assertLe(asset.balanceOf(address(staker)), keptLPToken);
        _assertCommonLeverage();
    }

    // ============================== HELPER FUNCTIONS =============================

    function _depositDirect(uint256 amount) internal {
        deal(address(asset), address(_alice), amount);
        vm.startPrank(_alice);
        // intermediary variables
        bytes memory data;
        {
            bytes[] memory oneInchData = new bytes[](0);

            bytes memory addData;
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

    function _depositSwapAndAddLiquidity(uint256[3] memory amounts, bool doSwaps)
        internal
        returns (uint256 minAmountOut)
    {
        // DAI - USDC - USDT - WBTC - WETH
        // can't mint null amounts on Aave market + overflow rapidly on their contracts
        amounts[0] = bound(amounts[0], 1, 10**24);
        amounts[1] = bound(amounts[1], 1, 10**12);
        amounts[2] = bound(amounts[2], 1, 10**12);

        uint256 swappedDAI = doSwaps ? 100000 ether : 0;
        uint256 swappedUSDT = doSwaps ? 100000 * 10**6 : 0;
        uint256 swappedUSDC = doSwaps ? 100000 * 10**6 : 0;

        deal(address(_DAI), address(_alice), swappedDAI + amounts[0]);
        deal(address(_USDC), address(_alice), swappedUSDC + amounts[1]);
        deal(address(_USDT), address(_alice), swappedUSDT + amounts[2]);

        vm.startPrank(_alice);
        // deal not working on those tokens
        _AAVE_LENDING_POOL.deposit(address(_DAI), amounts[0], address(_alice), 0);
        _AAVE_LENDING_POOL.deposit(address(_USDC), amounts[1], address(_alice), 0);
        _AAVE_LENDING_POOL.deposit(address(_USDT), amounts[2], address(_alice), 0);

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
            minAmountOut =
                (IMetaPool3(address(_METAPOOL)).calc_token_amount(
                    [
                        (swappedDAI * SLIPPAGE_BPS) / _BPS + amounts[0],
                        (swappedUSDC * SLIPPAGE_BPS) / _BPS + amounts[1],
                        (swappedUSDT * SLIPPAGE_BPS) / _BPS + amounts[2]
                    ],
                    true
                ) * SLIPPAGE_BPS) /
                _BPS;
        }

        bytes memory addData;
        bytes memory swapData = abi.encode(oneInchData, addData);
        bytes memory leverageData = abi.encode(true, _alice, swapData);
        bytes memory data = abi.encode(address(0), 0, SwapType.Leverage, leverageData);

        // we first need to send the tokens before hand, you should always use the swapper
        // in another tx to not losse your funds by front running
        _DAI.transfer(address(swapper), swappedDAI);
        _USDC.transfer(address(swapper), swappedUSDC);
        _USDT.safeTransfer(address(swapper), swappedUSDT);

        // rounding when calling deposit on Aave, it can consider we have less than what we just deposited
        _amDAI.safeTransfer(address(swapper), _amDAI.balanceOf(_alice));
        _amUSDC.safeTransfer(address(swapper), _amUSDC.balanceOf(_alice));
        _amUSDT.safeTransfer(address(swapper), _amUSDT.balanceOf(_alice));
        swapper.swap(IERC20(address(_USDC)), IERC20(address(staker)), _alice, 0, swappedUSDC, data);

        vm.stopPrank();
    }

    function _deleverageOneCoin(int128 coinIndex, IERC20 outToken) internal returns (uint256) {
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
            bytes memory removeData = abi.encode(CurveRemovalType.oneCoin, abi.encode(coinIndex, minOneCoin));
            bytes memory swapData = abi.encode(amount, sweepTokens, oneInchData, removeData);
            bytes memory leverageData = abi.encode(false, _alice, swapData);
            data = abi.encode(address(0), minOneCoin, SwapType.Leverage, leverageData);
        }
        staker.transfer(address(swapper), amount);
        swapper.swap(IERC20(address(staker)), outToken, _alice, 0, amount, data);

        vm.stopPrank();

        return minOneCoin;
    }

    function _deleverageBalance() internal returns (uint256[3] memory minAmounts) {
        vm.startPrank(_alice);
        // deleverage
        uint256 amount = staker.balanceOf(_alice);
        bytes memory data;
        {
            bytes[] memory oneInchData = new bytes[](0);
            IERC20[] memory sweepTokens = new IERC20[](2);
            sweepTokens[0] = _amUSDT;
            sweepTokens[1] = _amDAI;
            minAmounts = [
                (_METAPOOL.balances(0) * amount * SLIPPAGE_BPS) / (_BPS * asset.totalSupply()),
                (_METAPOOL.balances(1) * amount * SLIPPAGE_BPS) / (_BPS * asset.totalSupply()),
                (_METAPOOL.balances(2) * amount * SLIPPAGE_BPS) / (_BPS * asset.totalSupply())
            ];
            bytes memory removeData = abi.encode(CurveRemovalType.balance, abi.encode(minAmounts));
            bytes memory swapData = abi.encode(amount, sweepTokens, oneInchData, removeData);
            bytes memory leverageData = abi.encode(false, _alice, swapData);
            data = abi.encode(address(0), minAmounts[1], SwapType.Leverage, leverageData);
        }
        staker.transfer(address(swapper), amount);
        swapper.swap(IERC20(address(staker)), IERC20(address(_amUSDC)), _alice, 0, amount, data);

        vm.stopPrank();
    }

    function _deleverageImbalance(uint256 proportionWithdrawToken1, uint256 proportionWithdrawToken2)
        internal
        returns (uint256[3] memory amountOuts, uint256 keptLPToken)
    {
        vm.startPrank(_alice);
        // deleverage
        uint256 amount = staker.balanceOf(_alice);
        uint256 maxBurnAmount;
        bytes memory data;
        {
            {
                uint256[3] memory minAmounts = [
                    (_METAPOOL.balances(0) * amount) / (asset.totalSupply()),
                    (_METAPOOL.balances(1) * amount) / (asset.totalSupply()),
                    (_METAPOOL.balances(2) * amount) / (asset.totalSupply())
                ];
                // We do as if there were no slippage withdrawing in an imbalance manner vs a balance one and then
                // addd a slippage on the returned amount
                amountOuts = [
                    ((minAmounts[0] + minAmounts[1] * _DECIMAL_NORM_USDC + minAmounts[2] * _DECIMAL_NORM_USDT) *
                        (10**9 - proportionWithdrawToken1 - proportionWithdrawToken2) *
                        SLIPPAGE_BPS) / (10**9 * _BPS),
                    ((minAmounts[0] / _DECIMAL_NORM_USDC + minAmounts[1] + minAmounts[2]) *
                        proportionWithdrawToken1 *
                        SLIPPAGE_BPS) / (10**9 * _BPS),
                    ((minAmounts[0] / _DECIMAL_NORM_USDC + minAmounts[1] + minAmounts[2]) *
                        proportionWithdrawToken2 *
                        SLIPPAGE_BPS) / (10**9 * _BPS)
                ];
                // if we try to withdraw more than the curve balances -> rebalance
                uint256 curveBalanceDAI = _METAPOOL.balances(0);
                uint256 curveBalanceUSDC = _METAPOOL.balances(1);
                uint256 curveBalanceUSDT = _METAPOOL.balances(2);
                if (curveBalanceDAI < amountOuts[0]) {
                    amountOuts[0] = curveBalanceDAI**99 / 100;
                } else if (curveBalanceUSDC < amountOuts[1]) {
                    amountOuts[1] = curveBalanceUSDC**99 / 100;
                } else if (curveBalanceUSDT < amountOuts[2]) {
                    amountOuts[2] = curveBalanceUSDT**99 / 100;
                }
            }
            maxBurnAmount = IMetaPool3(address(_METAPOOL)).calc_token_amount(amountOuts, false);
            // Again there can be rounding issues on Aave because of the index value
            uint256 minAmountOut = amountOuts[1] > 5 wei ? amountOuts[1] - 5 wei : 0;

            bytes[] memory oneInchData = new bytes[](0);
            IERC20[] memory sweepTokens = new IERC20[](2);
            sweepTokens[0] = _amUSDT;
            sweepTokens[1] = _amDAI;
            bytes memory removeData = abi.encode(CurveRemovalType.imbalance, abi.encode(_bob, amountOuts));
            bytes memory swapData = abi.encode(amount, sweepTokens, oneInchData, removeData);
            bytes memory leverageData = abi.encode(false, _alice, swapData);
            data = abi.encode(address(0), minAmountOut, SwapType.Leverage, leverageData);
        }
        staker.transfer(address(swapper), amount);
        swapper.swap(IERC20(address(staker)), IERC20(address(_amUSDC)), _alice, 0, amount, data);

        vm.stopPrank();

        keptLPToken = amount - maxBurnAmount;
    }

    function _swapToImbalance(
        int128 coinSwapFrom,
        int128 coinSwapTo,
        uint256 swapAmount
    ) internal {
        // do a swap to change the pool state and withdraw womething different than what has been deposited
        coinSwapFrom = coinSwapFrom % 3;
        coinSwapTo = coinSwapTo % 3;
        vm.startPrank(_dylan);
        if (coinSwapFrom == 0) {
            swapAmount = bound(swapAmount, 10**18, 10**23);
            deal(address(_DAI), address(_dylan), swapAmount);
            _AAVE_LENDING_POOL.deposit(address(_DAI), swapAmount, address(_dylan), 0);
            // Aave rounding errors
            swapAmount = _amDAI.balanceOf(_dylan);
            _amDAI.approve(address(_METAPOOL), type(uint256).max);
        } else if (coinSwapFrom == 1) {
            swapAmount = bound(swapAmount, 10**6, 10**11);
            deal(address(_USDC), address(_dylan), swapAmount);
            _AAVE_LENDING_POOL.deposit(address(_USDC), swapAmount, address(_dylan), 0);
            // Aave rounding errors
            swapAmount = _amUSDC.balanceOf(_dylan);
            IERC20(address(_amUSDC)).approve(address(_METAPOOL), type(uint256).max);
        } else {
            swapAmount = bound(swapAmount, 10**6, 10**11);
            deal(address(_USDT), address(_dylan), swapAmount);
            _AAVE_LENDING_POOL.deposit(address(_USDT), swapAmount, address(_dylan), 0);
            // Aave rounding errors
            swapAmount = _amUSDT.balanceOf(_dylan);
            IERC20(address(_amUSDT)).approve(address(_METAPOOL), type(uint256).max);
        }
        _METAPOOL.exchange(coinSwapFrom, coinSwapTo, swapAmount, 0);

        vm.stopPrank();
    }

    function _assertCommonLeverage() internal {
        assertEq(staker.balanceOf(address(swapper)), 0);
        assertEq(asset.balanceOf(address(_alice)), 0);
        assertEq(asset.balanceOf(address(swapper)), 0);
        assertEq(asset.balanceOf(address(staker)), staker.totalSupply());
        assertEq(_USDT.balanceOf(_alice), 0);
        assertEq(_USDC.balanceOf(_alice), 0);
        assertEq(_DAI.balanceOf(_alice), 0);
        assertEq(_USDC.balanceOf(address(swapper)), 0);
        assertEq(_DAI.balanceOf(address(swapper)), 0);
        assertEq(_USDT.balanceOf(address(swapper)), 0);
        assertEq(_USDC.balanceOf(address(staker)), 0);
        assertEq(_DAI.balanceOf(address(staker)), 0);
        assertEq(_USDT.balanceOf(address(staker)), 0);
        assertEq(_amUSDC.balanceOf(address(swapper)), 0);
        assertEq(_amDAI.balanceOf(address(swapper)), 0);
        assertEq(_amUSDT.balanceOf(address(swapper)), 0);
        assertEq(_amUSDC.balanceOf(address(staker)), 0);
        assertEq(_amDAI.balanceOf(address(staker)), 0);
        assertEq(_amUSDT.balanceOf(address(staker)), 0);
    }

    function _assertCommonDeleverage() internal {
        _assertCommonLeverage();
        assertEq(staker.balanceOf(_alice), 0);
        assertEq(asset.balanceOf(address(staker)), 0);
        assertEq(staker.totalSupply(), 0);
    }
}
