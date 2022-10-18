// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.12;

import "@openzeppelin/contracts-upgradeable/interfaces/IERC20MetadataUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import "../BaseTest.test.sol";
import "../../../contracts/interfaces/external/convex/IBaseRewardPool.sol";
import "../../../contracts/interfaces/external/convex/IBooster.sol";
import "../../../contracts/interfaces/external/convex/IConvexToken.sol";
import "../../../contracts/interfaces/ICoreBorrow.sol";
import "../../../contracts/mock/MockTokenPermit.sol";
import { MockSanTokenStaker, BorrowStakerStorage, ILiquidityGauge, IERC20Metadata } from "../../../contracts/mock/MockSanTokenStaker.sol";

contract CurveLPTokenStakerTest is BaseTest {
    using stdStorage for StdStorage;

    address public ANGLEDistributor = 0x4f91F01cE8ec07c9B1f6a82c18811848254917Ab;
    IERC20 private constant _CRV = IERC20(0xD533a949740bb3306d119CC777fa900bA034cd52);
    IConvexToken private constant _CVX = IConvexToken(0x4e3FBD56CD56c3e72c1403e103b45Db9da5B9D2B);
    IERC20 public asset = IERC20(0x9C215206Da4bf108aE5aEEf9dA7caD3352A36Dad);
    IERC20[] public rewardToken = [_CRV, IERC20(address(_CVX))];
    uint256 public constant NBR_REWARD = 2;
    IConvexBooster public constant convexBooster = IConvexBooster(0xF403C135812408BFbE8713b5A23a04b3D48AAE31);
    IConvexBaseRewardPool public baseRewardPool = IConvexBaseRewardPool(0xA91fccC1ec9d4A2271B7A86a7509Ca05057C1A98);
    uint256 public constant POOL_ID = 113;

    MockSanTokenStaker public stakerImplementation;
    MockSanTokenStaker public staker;
    ILiquidityGauge public gauge;
    uint8 public decimalToken;
    uint256 public maxTokenAmount;
    uint8[] public decimalReward;
    uint256[] public rewardAmount;

    uint256 public constant REWARD_LENGTH = 2;
    uint256 public constant WITHDRAW_LENGTH = 5;

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
        decimalToken = IERC20Metadata(address(asset)).decimals();
        maxTokenAmount = 10**15 * 10**decimalToken;
        for (uint256 i = 0; i < rewardToken.length; i++) {
            decimalReward[i] = IERC20Metadata(address(rewardToken[i])).decimals();
            rewardAmount[i] = 10**2 * 10**(decimalReward[i]);
        }
    }

    // ============================= DEPOSIT / WITHDRAW ============================

    // function testBorrowStakerCurveLP(
    //     uint256[WITHDRAW_LENGTH] memory amounts,
    //     bool[WITHDRAW_LENGTH] memory isDeposit,
    //     uint256[WITHDRAW_LENGTH] memory accounts,
    //     uint256[WITHDRAW_LENGTH + REWARD_LENGTH] memory elapseTimes,
    //     bool[REWARD_LENGTH] memory isRewardTime // uint256[REWARD_LENGTH] memory rewards
    // ) public {
    //     amounts[0] = bound(amounts[0], 1, maxTokenAmount);
    //     deal(address(asset), _alice, amounts[0]);
    //     vm.startPrank(_alice);
    //     asset.approve(address(staker), amounts[0]);
    //     staker.deposit(amounts[0], _alice);
    //     vm.stopPrank();

    //     uint256[4][NBR_REWARD] memory pendingRewards = new uint256[][]();

    //     uint256 indexOnDeposit = 1;
    //     uint256 indexOnReward;
    //     while (indexOnDeposit < amounts.length && indexOnReward < isRewardTime.length) {
    //         elapseTimes[indexOnReward + indexOnDeposit] = bound(
    //             elapseTimes[indexOnReward + indexOnDeposit],
    //             1,
    //             180 days
    //         );
    //         vm.warp(block.timestamp + elapseTimes[indexOnReward + indexOnDeposit]);
    //         if (isRewardTime[indexOnReward]) {
    //             _depositRewards(rewardAmount[0]);
    //             indexOnReward++;
    //         } else {
    //             uint256 randomIndex = bound(accounts[indexOnDeposit], 0, 3);
    //             address account = randomIndex == 0 ? _alice : randomIndex == 1 ? _bob : randomIndex == 2
    //                 ? _charlie
    //                 : _dylan;
    //             if (staker.balanceOf(account) == 0) isDeposit[indexOnDeposit] = true;

    //             {
    //                 uint256 totSupply = staker.totalSupply();
    //                 uint256 claimableRewardsFromStaker = gauge.claimable_reward(address(staker), address(rewardToken));
    //                 if (totSupply > 0) {
    //                     pendingRewards[0] +=
    //                         (staker.balanceOf(_alice) * claimableRewardsFromStaker) /
    //                         staker.totalSupply();
    //                     pendingRewards[1] +=
    //                         (staker.balanceOf(_bob) * claimableRewardsFromStaker) /
    //                         staker.totalSupply();
    //                     pendingRewards[2] +=
    //                         (staker.balanceOf(_charlie) * claimableRewardsFromStaker) /
    //                         staker.totalSupply();
    //                     pendingRewards[3] +=
    //                         (staker.balanceOf(_dylan) * claimableRewardsFromStaker) /
    //                         staker.totalSupply();
    //                 }
    //             }

    //             uint256 amount;
    //             vm.startPrank(account);
    //             if (isDeposit[indexOnDeposit]) {
    //                 amount = bound(amounts[indexOnDeposit], 1, maxTokenAmount);
    //                 deal(address(asset), account, amount);
    //                 asset.approve(address(staker), amount);

    //                 uint256[] memory prevRewardTokenBalance = new uint256[](rewardToken.length);
    //                 for (uint256 j = 0; j < rewardToken.length; j++) {
    //                     prevRewardTokenBalance[j] = rewardToken[j].balanceOf(account);
    //                 }
    //                 staker.deposit(amount, account);
    //                 for (uint256 j = 0; j < rewardToken.length; j++) {
    //                     assertEq(rewardToken[j].balanceOf(account), prevRewardTokenBalance[j]);
    //                 }
    //             } else {
    //                 amount = bound(amounts[indexOnDeposit], 1, 10**9);
    //                 staker.withdraw((amount * staker.balanceOf(account)) / 10**9, account, account);
    //                 for (uint256 j = 0; j < rewardToken.length; j++) {
    //                     assertEq(staker.pendingRewardsOf(rewardToken[j], account), 0);
    //                 }
    //             }
    //             vm.stopPrank();

    //             for (uint256 j = 0; j < rewardToken.length; j++) {
    //                 assertEq(staker.pendingRewardsOf(rewardToken[j], account), 0);
    //                 assertApproxEqAbs(
    //                     rewardToken[j].balanceOf(account) + staker.pendingRewardsOf(rewardToken[j], account),
    //                     pendingRewards[randomIndex],
    //                     10**(decimalReward[j] - 4)
    //                 );
    //             }

    //             indexOnDeposit++;
    //         }

    //         // check on claimable rewards / added the Governor to just have an address with no stake --> should be 0
    //         address[5] memory allAccounts = [_alice, _bob, _charlie, _dylan, _GOVERNOR];
    //         for (uint256 i = 0; i < allAccounts.length; i++) {
    //             uint256[] memory prevRewardTokenBalance = new uint256[](rewardToken.length);
    //             uint256[] memory functionClaimableRewards = new uint256[](rewardToken.length);
    //             for (uint256 j = 0; j < rewardToken.length; j++) {
    //                 prevRewardTokenBalance[j] = rewardToken[j].balanceOf(allAccounts[i]);
    //                 functionClaimableRewards[j] = staker.claimableRewards(allAccounts[i], rewardToken[j]);
    //             }
    //             uint256[] memory claimedRewards = staker.claimRewards(allAccounts[i]);
    //             for (uint256 j = 0; j < rewardToken.length; j++) {
    //                 assertEq(functionClaimableRewards[j], claimedRewards[j]);
    //                 assertEq(
    //                     rewardToken[j].balanceOf(allAccounts[i]) - prevRewardTokenBalance[j],
    //                     functionClaimableRewards[j]
    //                 );
    //             }
    //         }
    //     }
    // }

    // // ================================== INTERNAL =================================

    // function _depositRewards(uint256 amount) internal {
    //     amount = bound(amount, 1 ether, 10_000_000 ether);
    //     deal(address(_CRV), address(baseRewardPool), amount);
    //     // fake a non null incentives program on Convex
    //     vm.prank(address(convexBooster));
    //     baseRewardPool.queueNewRewards(amount);
    // }

    // function _rewardsToBeClaimed(IERC20 rewardToken) internal view returns (uint256 amount) {
    //     amount = baseRewardPool.earned(address(this));
    //     if (rewardToken == IERC20(address(_CVX))) {
    //         // Computation made in the Convex token when claiming rewards check
    //         // https://etherscan.io/address/0x4e3fbd56cd56c3e72c1403e103b45db9da5b9d2b#code
    //         uint256 totalSupply = _CVX.totalSupply();
    //         uint256 cliff = totalSupply / _CVX.reductionPerCliff();
    //         uint256 totalCliffs = _CVX.totalCliffs();
    //         if (cliff < totalCliffs) {
    //             uint256 reduction = totalCliffs - cliff;
    //             amount = (amount * reduction) / totalCliffs;

    //             uint256 amtTillMax = _CVX.maxSupply() - totalSupply;
    //             if (amount > amtTillMax) {
    //                 amount = amtTillMax;
    //             }
    //         }
    //     }
    // }
}
