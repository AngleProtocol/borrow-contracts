// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.12;

import "@openzeppelin/contracts-upgradeable/interfaces/IERC20MetadataUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import "../BaseTest.test.sol";
import "../../../contracts/interfaces/ICoreBorrow.sol";
import "../../../contracts/mock/MockTokenPermit.sol";
import { MockSanTokenStaker, BorrowStakerStorage, ILiquidityGauge } from "../../../contracts/mock/MockSanTokenStaker.sol";

contract SanTokenStakerTest is BaseTest {
    using stdStorage for StdStorage;

    address public ANGLEDistributor = 0x4f91F01cE8ec07c9B1f6a82c18811848254917Ab;
    IERC20 public asset = IERC20(0x9C215206Da4bf108aE5aEEf9dA7caD3352A36Dad);
    IERC20 public rewardToken = IERC20(_ANGLE);

    MockSanTokenStaker public stakerImplementation;
    MockSanTokenStaker public staker;
    ILiquidityGauge public gauge;
    uint8 public decimalToken;
    uint256 public minTokenAmount;
    uint256 public maxTokenAmount;
    uint8 public decimalReward;
    uint256 public rewardAmount;

    uint256 public constant REWARD_LENGTH = 7;
    uint256 public constant WITHDRAW_LENGTH = 50;

    function setUp() public override {
        _ethereum = vm.createFork(vm.envString("ETH_NODE_URI_MAINNET"), 15775969);
        vm.selectFork(_ethereum);

        super.setUp();
        stakerImplementation = new MockSanTokenStaker();
        staker = MockSanTokenStaker(
            deployUpgradeable(
                address(stakerImplementation),
                abi.encodeWithSelector(staker.initialize.selector, coreBorrow, asset)
            )
        );
        gauge = staker.liquidityGauge();
        decimalReward = IERC20Metadata(address(rewardToken)).decimals();
        rewardAmount = 10**2 * 10**(decimalReward);
        decimalToken = IERC20Metadata(address(asset)).decimals();
        maxTokenAmount = 10**15 * 10**decimalToken;
        minTokenAmount = 1;
    }

    function testSanTokenBorrowStakerRewards(
        uint256[WITHDRAW_LENGTH] memory amounts,
        bool[WITHDRAW_LENGTH] memory isDeposit,
        uint256[WITHDRAW_LENGTH] memory accounts,
        uint256[WITHDRAW_LENGTH + REWARD_LENGTH] memory elapseTimes,
        bool[REWARD_LENGTH] memory isRewardTime // uint256[REWARD_LENGTH] memory rewards
    ) public {
        amounts[0] = bound(amounts[0], minTokenAmount, maxTokenAmount);
        deal(address(asset), _alice, amounts[0]);
        vm.startPrank(_alice);
        asset.approve(address(staker), amounts[0]);
        staker.deposit(amounts[0], _alice);
        vm.stopPrank();

        uint256[5] memory pendingRewards;

        uint256 indexOnDeposit = 1;
        uint256 indexOnReward;
        while (indexOnDeposit < amounts.length && indexOnReward < isRewardTime.length) {
            elapseTimes[indexOnReward + indexOnDeposit] = bound(
                elapseTimes[indexOnReward + indexOnDeposit],
                1,
                180 days
            );
            vm.warp(block.timestamp + elapseTimes[indexOnReward + indexOnDeposit]);
            if (isRewardTime[indexOnReward]) {
                _depositRewards(rewardAmount);
                indexOnReward++;
            } else {
                uint256 randomIndex = bound(accounts[indexOnDeposit], 0, 3);
                address account = randomIndex == 0 ? _alice : randomIndex == 1 ? _bob : randomIndex == 2
                    ? _charlie
                    : _dylan;
                if (staker.balanceOf(account) == 0) isDeposit[indexOnDeposit] = true;

                {
                    uint256 totSupply = staker.totalSupply();
                    uint256 claimableRewardsFromStaker = gauge.claimable_reward(address(staker), address(rewardToken));
                    if (totSupply > 0) {
                        pendingRewards[0] +=
                            (staker.balanceOf(_alice) * claimableRewardsFromStaker) /
                            staker.totalSupply();
                        pendingRewards[1] +=
                            (staker.balanceOf(_bob) * claimableRewardsFromStaker) /
                            staker.totalSupply();
                        pendingRewards[2] +=
                            (staker.balanceOf(_charlie) * claimableRewardsFromStaker) /
                            staker.totalSupply();
                        pendingRewards[3] +=
                            (staker.balanceOf(_dylan) * claimableRewardsFromStaker) /
                            staker.totalSupply();
                    }
                }

                uint256 amount;
                vm.startPrank(account);
                if (isDeposit[indexOnDeposit]) {
                    amount = bound(amounts[indexOnDeposit], minTokenAmount, maxTokenAmount);
                    deal(address(asset), account, amount);
                    asset.approve(address(staker), amount);

                    uint256 prevRewardTokenBalance = rewardToken.balanceOf(account);
                    staker.deposit(amount, account);
                    assertEq(rewardToken.balanceOf(account), prevRewardTokenBalance);
                } else {
                    amount = bound(amounts[indexOnDeposit], 1, 10**9);
                    staker.withdraw((amount * staker.balanceOf(account)) / 10**9, account, account);
                    assertEq(staker.pendingRewardsOf(rewardToken, account), 0);
                }
                vm.stopPrank();

                assertApproxEqAbs(
                    rewardToken.balanceOf(account) + staker.pendingRewardsOf(rewardToken, account),
                    pendingRewards[randomIndex],
                    10**(decimalReward - 4)
                );
                indexOnDeposit++;
            }

            // not working so far I don't know why
            // // check on claimable rewards / added the Governor to just have an address with no stake --> should be 0
            // address[5] memory allAccounts = [_alice, _bob, _charlie, _dylan, _GOVERNOR];
            // for (uint256 i = 0; i < allAccounts.length; i++) {
            //     uint256 prevRewardTokenBalance = rewardToken.balanceOf(allAccounts[i]);
            //     uint256 functionClaimableRewards = staker.claimableRewards(allAccounts[i], rewardToken);
            //     uint256[] memory claimedRewards = staker.claimRewards(allAccounts[i]);
            //     assertEq(functionClaimableRewards, claimedRewards[0]);
            //     assertEq(rewardToken.balanceOf(allAccounts[i]) - prevRewardTokenBalance, functionClaimableRewards);
            //     pendingRewards[i] += functionClaimableRewards;
            // }
        }
    }

    function testSanTokenBorrowStakerClaimable(
        uint256[WITHDRAW_LENGTH] memory amounts,
        bool[WITHDRAW_LENGTH] memory isDeposit,
        uint256[WITHDRAW_LENGTH] memory accounts,
        uint256[WITHDRAW_LENGTH + REWARD_LENGTH] memory elapseTimes,
        bool[REWARD_LENGTH] memory isRewardTime // uint256[REWARD_LENGTH] memory rewards
    ) public {
        amounts[0] = bound(amounts[0], minTokenAmount, maxTokenAmount);
        deal(address(asset), _alice, amounts[0]);
        vm.startPrank(_alice);
        asset.approve(address(staker), amounts[0]);
        staker.deposit(amounts[0], _alice);
        vm.stopPrank();

        uint256 indexOnDeposit = 1;
        uint256 indexOnReward;
        while (indexOnDeposit < amounts.length && indexOnReward < isRewardTime.length) {
            elapseTimes[indexOnReward + indexOnDeposit] = bound(
                elapseTimes[indexOnReward + indexOnDeposit],
                1,
                180 days
            );
            vm.warp(block.timestamp + elapseTimes[indexOnReward + indexOnDeposit]);
            if (isRewardTime[indexOnReward]) {
                _depositRewards(rewardAmount);
                indexOnReward++;
            } else {
                uint256 randomIndex = bound(accounts[indexOnDeposit], 0, 3);
                address account = randomIndex == 0 ? _alice : randomIndex == 1 ? _bob : randomIndex == 2
                    ? _charlie
                    : _dylan;
                if (staker.balanceOf(account) == 0) isDeposit[indexOnDeposit] = true;

                uint256 amount;
                vm.startPrank(account);
                if (isDeposit[indexOnDeposit]) {
                    amount = bound(amounts[indexOnDeposit], minTokenAmount, maxTokenAmount);
                    deal(address(asset), account, amount);
                    asset.approve(address(staker), amount);

                    uint256 prevRewardTokenBalance = rewardToken.balanceOf(account);
                    staker.deposit(amount, account);
                    assertEq(rewardToken.balanceOf(account), prevRewardTokenBalance);
                } else {
                    amount = bound(amounts[indexOnDeposit], 1, 10**9);
                    staker.withdraw((amount * staker.balanceOf(account)) / 10**9, account, account);
                    assertEq(staker.pendingRewardsOf(rewardToken, account), 0);
                }
                vm.stopPrank();
                indexOnDeposit++;
            }

            // check on claimable rewards / added the Governor to just have an address with no stake --> should be 0
            address[5] memory allAccounts = [_alice, _bob, _charlie, _dylan, _GOVERNOR];
            for (uint256 i = 0; i < allAccounts.length; i++) {
                uint256 prevRewardTokenBalance = rewardToken.balanceOf(allAccounts[i]);
                uint256 functionClaimableRewards = staker.claimableRewards(allAccounts[i], rewardToken);
                uint256[] memory claimedRewards = staker.claimRewards(allAccounts[i]);
                assertEq(functionClaimableRewards, claimedRewards[0]);
                assertEq(rewardToken.balanceOf(allAccounts[i]) - prevRewardTokenBalance, functionClaimableRewards);
            }
        }
    }

    // ================================== INTERNAL =================================

    function _depositRewards(uint256 amount) internal {
        deal(_ANGLE, ANGLEDistributor, amount);
        vm.startPrank(ANGLEDistributor);
        rewardToken.approve(address(gauge), amount);
        gauge.deposit_reward_token(address(rewardToken), amount);
        vm.stopPrank();
    }
}
