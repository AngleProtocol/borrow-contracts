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
import { MockBorrowStakerReset } from "../../../contracts/mock/MockBorrowStaker.sol";

contract LevSwapperTestE2E is BaseTest {
    using stdStorage for StdStorage;
    using SafeERC20 for IERC20;

    IERC20 public asset;
    address internal _hacker = address(uint160(uint256(keccak256(abi.encodePacked("hacker")))));
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
    MockBorrowStakerReset public stakerImplementation;
    MockBorrowStakerReset public staker;
    uint8 public decimalToken = 18;
    uint8[] public decimalReward;
    uint256 public maxTokenAmount = 10**15 * 10**decimalToken;

    IERC20 public rewardToken;
    IERC20[] public listRewardTokens;
    uint256 public constant NBR_REWARD = 1;

    uint256 public constant DEPOSIT_LENGTH = 10;
    uint256 public constant WITHDRAW_LENGTH = 10;
    uint256 public constant CLAIMABLE_LENGTH = 50;
    uint256 public constant CLAIM_LENGTH = 50;

    function setUp() public override {
        super.setUp();

        _ethereum = vm.createFork(vm.envString("ETH_NODE_URI_MAINNET"), 15824909);
        vm.selectFork(_ethereum);

        rewardToken = IERC20(new MockTokenPermit("reward", "rwd", 6));
        listRewardTokens = [rewardToken];

        // reset coreBorrow because the `makePersistent()` doens't work on my end
        coreBorrow = new MockCoreBorrow();
        coreBorrow.toggleGuardian(_GUARDIAN);
        coreBorrow.toggleGovernor(_GOVERNOR);

        asset = _USDC;
        stakerImplementation = new MockBorrowStakerReset();
        staker = MockBorrowStakerReset(
            deployUpgradeable(address(stakerImplementation), abi.encodeWithSelector(staker.setAsset.selector, asset))
        );
        staker.initialize(coreBorrow);
        swapper = new MockBaseLevSwapper(
            coreBorrow,
            _UNI_V3_ROUTER,
            _ONE_INCH,
            _ANGLE_ROUTER,
            IBorrowStaker(address(staker))
        );

        decimalReward = new uint8[](listRewardTokens.length);
        for (uint256 i = 0; i < listRewardTokens.length; i++) {
            decimalReward[i] = IERC20Metadata(address(listRewardTokens[i])).decimals();
        }

        staker.setRewardToken(rewardToken);

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

        address[4] memory allAccounts = [_alice, _bob, _charlie, _dylan];
        for (uint256 k = 0; k < allAccounts.length; k++) {
            vm.startPrank(allAccounts[k]);
            _USDC.approve(address(swapper), type(uint256).max);
            _USDT.safeIncreaseAllowance(address(swapper), type(uint256).max);
            _FRAX.approve(address(swapper), type(uint256).max);
            vm.stopPrank();
        }
    }

    function testBorrowStakerCurveLP(
        uint256[WITHDRAW_LENGTH] memory amounts,
        uint256[WITHDRAW_LENGTH] memory depositWithdrawRewards,
        uint256[WITHDRAW_LENGTH] memory accounts,
        uint256[WITHDRAW_LENGTH] memory elapseTimes,
        uint256[WITHDRAW_LENGTH] memory rewardAmounts
    ) public {
        // fill enormous quantity of reward tokens in the staker
        deal(address(rewardToken), address(staker), type(uint256).max);

        amounts[0] = bound(amounts[0], 1, maxTokenAmount);
        deal(address(asset), _alice, amounts[0]);
        vm.startPrank(_alice);
        {
            bytes memory data;
            {
                // intermediary variables
                bool leverage = true;
                address stakeFor = _alice;
                bytes[] memory oneInchData = new bytes[](0);
                bytes memory addData;
                bytes memory swapData = abi.encode(oneInchData, addData);
                bytes memory leverageData = abi.encode(leverage, stakeFor, swapData);
                data = abi.encode(address(0), 0, SwapType.Leverage, leverageData);
            }
            // we first need to send the tokens before hand, you should always use the swapper
            // in another tx to not losse your funds by front running
            asset.transfer(address(swapper), amounts[0]);
            swapper.swap(IERC20(address(asset)), IERC20(address(staker)), _alice, 0, amounts[0], data);
        }
        vm.stopPrank();

        uint256[NBR_REWARD][5] memory pendingRewards;

        for (uint256 i = 0; i < amounts.length; i++) {
            elapseTimes[i] = bound(elapseTimes[i], 1, 180 days);
            vm.warp(block.timestamp + elapseTimes[i]);
            if (depositWithdrawRewards[i] % 3 == 2) {
                rewardAmounts[i] = bound(rewardAmounts[i], 0, 10**10 * 10**decimalReward[0]);
                staker.setRewardAmount(rewardAmounts[i]);
            } else {
                uint256 randomIndex = bound(accounts[i], 0, 3);
                address account = randomIndex == 0 ? _alice : randomIndex == 1 ? _bob : randomIndex == 2
                    ? _charlie
                    : _dylan;
                if (staker.balanceOf(account) == 0) depositWithdrawRewards[i] = 0;

                {
                    for (uint256 j = 0; j < listRewardTokens.length; j++) {
                        uint256 totSupply = staker.totalSupply();
                        uint256 claimableRewardsFromStaker = staker.rewardAmount();
                        if (totSupply > 0) {
                            pendingRewards[0][j] +=
                                (staker.balanceOf(_alice) * claimableRewardsFromStaker) /
                                staker.totalSupply();
                            pendingRewards[1][j] +=
                                (staker.balanceOf(_bob) * claimableRewardsFromStaker) /
                                staker.totalSupply();
                            pendingRewards[2][j] +=
                                (staker.balanceOf(_charlie) * claimableRewardsFromStaker) /
                                staker.totalSupply();
                            pendingRewards[3][j] +=
                                (staker.balanceOf(_dylan) * claimableRewardsFromStaker) /
                                staker.totalSupply();
                        }
                    }
                }

                uint256 amount;
                vm.startPrank(account);
                if (depositWithdrawRewards[i] % 3 == 0) {
                    amount = bound(amounts[i], 1, maxTokenAmount);
                    deal(address(asset), account, amount);
                    asset.approve(address(staker), amount);

                    uint256[] memory prevRewardTokenBalance = new uint256[](listRewardTokens.length);
                    for (uint256 j = 0; j < listRewardTokens.length; j++) {
                        prevRewardTokenBalance[j] = listRewardTokens[j].balanceOf(account);
                    }
                    {
                        bytes memory data;
                        {
                            // intermediary variables
                            bool leverage = true;
                            address stakeFor = account;
                            bytes[] memory oneInchData = new bytes[](0);
                            bytes memory addData;
                            bytes memory swapData = abi.encode(oneInchData, addData);
                            bytes memory leverageData = abi.encode(leverage, stakeFor, swapData);
                            data = abi.encode(address(0), 0, SwapType.Leverage, leverageData);
                        }
                        // we first need to send the tokens before hand, you should always use the swapper
                        // in another tx to not losse your funds by front running
                        asset.transfer(address(swapper), amount);
                        swapper.swap(IERC20(address(asset)), IERC20(address(staker)), account, 0, amount, data);
                    }

                    for (uint256 j = 0; j < listRewardTokens.length; j++) {
                        assertEq(listRewardTokens[j].balanceOf(account), prevRewardTokenBalance[j]);
                    }
                } else {
                    amount = bound(amounts[i], 1, 10**9);
                    staker.withdraw((amount * staker.balanceOf(account)) / 10**9, account, account);
                    {
                        bytes memory data;
                        uint256 toUnstake = (amount * staker.balanceOf(account)) / 10**9;
                        {
                            // deleverage
                            bool leverage = false;
                            address stakeFor = account;
                            IERC20[] memory sweepToken = new IERC20[](0);
                            bytes[] memory oneInchData;
                            bytes memory addData;
                            bytes memory swapData = abi.encode(toUnstake, sweepToken, oneInchData, addData);
                            bytes memory leverageData = abi.encode(leverage, stakeFor, swapData);
                            data = abi.encode(address(0), 0, SwapType.Leverage, leverageData);
                        }
                        staker.transfer(address(swapper), toUnstake);
                        swapper.swap(IERC20(address(staker)), IERC20(address(asset)), account, 0, toUnstake, data);
                    }
                    for (uint256 j = 0; j < listRewardTokens.length; j++) {
                        assertEq(staker.pendingRewardsOf(listRewardTokens[j], account), 0);
                    }
                }
                vm.stopPrank();

                for (uint256 j = 0; j < listRewardTokens.length; j++) {
                    assertApproxEqAbs(
                        listRewardTokens[j].balanceOf(account) + staker.pendingRewardsOf(listRewardTokens[j], account),
                        pendingRewards[randomIndex][j],
                        10**(decimalReward[j] - 4)
                    );
                }
            }

            // check on claimable rewards / added the Governor to just have an address with no stake --> should be 0
            address[5] memory allAccounts = [_alice, _bob, _charlie, _dylan, _hacker];
            for (uint256 k = 0; k < allAccounts.length; k++) {
                uint256[] memory prevRewardTokenBalance = new uint256[](listRewardTokens.length);
                uint256[] memory functionClaimableRewards = new uint256[](listRewardTokens.length);
                for (uint256 j = 0; j < listRewardTokens.length; j++) {
                    prevRewardTokenBalance[j] = listRewardTokens[j].balanceOf(allAccounts[k]);
                    functionClaimableRewards[j] = staker.claimableRewards(allAccounts[k], listRewardTokens[j]);
                }
                uint256[] memory claimedRewards = staker.claimRewards(allAccounts[k]);
                for (uint256 j = 0; j < listRewardTokens.length; j++) {
                    assertEq(functionClaimableRewards[j], claimedRewards[j]);
                    assertEq(
                        listRewardTokens[j].balanceOf(allAccounts[k]) - prevRewardTokenBalance[j],
                        functionClaimableRewards[j]
                    );
                    // Otherwise it has already been taken into account when deposit/withdraw
                    if (depositWithdrawRewards[i] % 3 == 2) pendingRewards[k][j] += functionClaimableRewards[j];

                    assertApproxEqAbs(
                        listRewardTokens[j].balanceOf(allAccounts[k]) +
                            staker.pendingRewardsOf(listRewardTokens[j], allAccounts[k]),
                        pendingRewards[k][j],
                        10**(decimalReward[j] - 4)
                    );
                }
            }
        }
    }
}
