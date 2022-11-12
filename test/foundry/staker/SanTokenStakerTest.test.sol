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
    address internal _hacker = address(uint160(uint256(keccak256(abi.encodePacked("hacker")))));

    MockSanTokenStaker public stakerImplementation;
    MockSanTokenStaker public staker;
    ILiquidityGauge public gauge;
    uint8 public decimalToken;
    uint256 public minTokenAmount;
    uint256 public maxTokenAmount;
    uint8 public decimalReward;
    uint256 public rewardAmount;

    uint256 public constant WITHDRAW_LENGTH = 50;

    function setUp() public override {
        _ethereum = vm.createFork(vm.envString("ETH_NODE_URI_MAINNET"), 15775969);
        vm.selectFork(_ethereum);

        super.setUp();
        stakerImplementation = new MockSanTokenStaker();
        staker = MockSanTokenStaker(
            deployUpgradeable(
                address(stakerImplementation),
                abi.encodeWithSelector(staker.initialize.selector, coreBorrow)
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
        uint256[WITHDRAW_LENGTH] memory depositWithdrawRewards,
        uint256[WITHDRAW_LENGTH] memory accounts,
        uint256[WITHDRAW_LENGTH] memory elapseTimes
    ) public {
        amounts[0] = bound(amounts[0], minTokenAmount, maxTokenAmount);
        deal(address(asset), _alice, amounts[0]);
        vm.startPrank(_alice);
        asset.approve(address(staker), amounts[0]);
        staker.deposit(amounts[0], _alice);
        vm.stopPrank();

        uint256[5] memory pendingRewards;

        for (uint256 i = 0; i < amounts.length; i++) {
            elapseTimes[i] = bound(elapseTimes[i], 1, 180 days);
            vm.warp(block.timestamp + elapseTimes[i]);
            if (depositWithdrawRewards[i] % 3 == 2) {
                _depositRewards(rewardAmount);
            } else {
                uint256 randomIndex = bound(accounts[i], 0, 3);
                address account = randomIndex == 0 ? _alice : randomIndex == 1 ? _bob : randomIndex == 2
                    ? _charlie
                    : _dylan;
                if (staker.balanceOf(account) == 0) depositWithdrawRewards[i] = 0;

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
                if (depositWithdrawRewards[i] % 3 == 0) {
                    amount = bound(amounts[i], minTokenAmount, maxTokenAmount);
                    deal(address(asset), account, amount);
                    asset.approve(address(staker), amount);

                    uint256 prevRewardTokenBalance = rewardToken.balanceOf(account);
                    staker.deposit(amount, account);
                    assertEq(rewardToken.balanceOf(account), prevRewardTokenBalance);
                } else {
                    amount = bound(amounts[i], 1, 10**9);
                    staker.withdraw((amount * staker.balanceOf(account)) / 10**9, account, account);
                    assertEq(staker.pendingRewardsOf(rewardToken, account), 0);
                }
                vm.stopPrank();

                assertApproxEqAbs(
                    rewardToken.balanceOf(account) + staker.pendingRewardsOf(rewardToken, account),
                    pendingRewards[randomIndex],
                    10**(decimalReward - 4)
                );
            }

            // not working so far I don't know why
            // check on claimable rewards / added the Governor to just have an address with no stake --> should be 0
            address[5] memory allAccounts = [_alice, _bob, _charlie, _dylan, _hacker];
            for (uint256 j = 0; j < allAccounts.length; j++) {
                uint256 prevRewardTokenBalance = rewardToken.balanceOf(allAccounts[j]);
                uint256 functionClaimableRewards = staker.claimableRewards(allAccounts[j], rewardToken);
                uint256[] memory claimedRewards = staker.claimRewards(allAccounts[j]);
                assertEq(functionClaimableRewards, claimedRewards[0]);
                assertEq(rewardToken.balanceOf(allAccounts[j]) - prevRewardTokenBalance, functionClaimableRewards);
                // Otherwise it has already been taken into account when deposit/withdraw
                if (depositWithdrawRewards[i] % 3 == 2) pendingRewards[j] += functionClaimableRewards;

                assertApproxEqAbs(
                    rewardToken.balanceOf(allAccounts[j]) + staker.pendingRewardsOf(rewardToken, allAccounts[j]),
                    pendingRewards[j],
                    10**(decimalReward - 4)
                );
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
