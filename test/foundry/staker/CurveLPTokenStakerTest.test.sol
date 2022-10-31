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
import { MockConvexTokenStaker, BorrowStakerStorage, IERC20Metadata } from "../../../contracts/mock/MockConvexTokenStaker.sol";

contract CurveLPTokenStakerTest is BaseTest {
    using stdStorage for StdStorage;

    address internal _hacker = address(uint160(uint256(keccak256(abi.encodePacked("hacker")))));
    IERC20 private constant _CRV = IERC20(0xD533a949740bb3306d119CC777fa900bA034cd52);
    IConvexToken private constant _CVX = IConvexToken(0x4e3FBD56CD56c3e72c1403e103b45Db9da5B9D2B);
    IERC20 public asset = IERC20(0xBa3436Fd341F2C8A928452Db3C5A3670d1d5Cc73);
    IERC20[] public rewardToken = [_CRV, _CVX];
    uint256 public constant NBR_REWARD = 2;
    IConvexBooster public convexBooster = IConvexBooster(0xF403C135812408BFbE8713b5A23a04b3D48AAE31);
    IConvexBaseRewardPool public baseRewardPool = IConvexBaseRewardPool(0xA91fccC1ec9d4A2271B7A86a7509Ca05057C1A98);
    uint256 public constant POOL_ID = 113;

    MockConvexTokenStaker public stakerImplementation;
    MockConvexTokenStaker public staker;
    uint8 public decimalToken;
    uint256 public maxTokenAmount;
    uint8[] public decimalReward;
    uint256[] public rewardAmount;

    uint256 public constant WITHDRAW_LENGTH = 10;

    function setUp() public override {
        _ethereum = vm.createFork(vm.envString("ETH_NODE_URI_MAINNET"), 15775969);
        vm.selectFork(_ethereum);

        super.setUp();
        stakerImplementation = new MockConvexTokenStaker();
        staker = MockConvexTokenStaker(
            deployUpgradeable(
                address(stakerImplementation),
                abi.encodeWithSelector(staker.initialize.selector, coreBorrow, asset)
            )
        );
        decimalToken = IERC20Metadata(address(asset)).decimals();
        maxTokenAmount = 10**15 * 10**decimalToken;
        decimalReward = new uint8[](rewardToken.length);
        rewardAmount = new uint256[](rewardToken.length);
        for (uint256 i = 0; i < rewardToken.length; i++) {
            decimalReward[i] = IERC20Metadata(address(rewardToken[i])).decimals();
            rewardAmount[i] = 10**2 * 10**(decimalReward[i]);
        }
    }

    // ============================= DEPOSIT / WITHDRAW ============================

    function testBorrowStakerCurveLP(
        uint256[WITHDRAW_LENGTH] memory amounts,
        uint256[WITHDRAW_LENGTH] memory depositWithdrawRewards,
        uint256[WITHDRAW_LENGTH] memory accounts,
        uint256[WITHDRAW_LENGTH] memory elapseTimes
    ) public {
        amounts[0] = bound(amounts[0], 1, maxTokenAmount);
        deal(address(asset), _alice, amounts[0]);
        vm.startPrank(_alice);
        asset.approve(address(staker), amounts[0]);
        staker.deposit(amounts[0], _alice);
        vm.stopPrank();

        uint256[NBR_REWARD][5] memory pendingRewards;

        for (uint256 i = 0; i < amounts.length; i++) {
            elapseTimes[i] = bound(elapseTimes[i], 1, 180 days);
            vm.warp(block.timestamp + elapseTimes[i]);
            if (depositWithdrawRewards[i] % 3 == 2) {
                _depositRewards(rewardAmount[0]);
            } else {
                uint256 randomIndex = bound(accounts[i], 0, 3);
                address account = randomIndex == 0 ? _alice : randomIndex == 1 ? _bob : randomIndex == 2
                    ? _charlie
                    : _dylan;
                if (staker.balanceOf(account) == 0) depositWithdrawRewards[i] = 0;

                {
                    for (uint256 j = 0; j < rewardToken.length; j++) {
                        uint256 totSupply = staker.totalSupply();
                        uint256 claimableRewardsFromStaker = _rewardsToBeClaimed(rewardToken[j]);
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

                    uint256[] memory prevRewardTokenBalance = new uint256[](rewardToken.length);
                    for (uint256 j = 0; j < rewardToken.length; j++) {
                        prevRewardTokenBalance[j] = rewardToken[j].balanceOf(account);
                    }
                    staker.deposit(amount, account);
                    for (uint256 j = 0; j < rewardToken.length; j++) {
                        assertEq(rewardToken[j].balanceOf(account), prevRewardTokenBalance[j]);
                    }
                } else {
                    amount = bound(amounts[i], 1, 10**9);
                    staker.withdraw((amount * staker.balanceOf(account)) / 10**9, account, account);
                    for (uint256 j = 0; j < rewardToken.length; j++) {
                        assertEq(staker.pendingRewardsOf(rewardToken[j], account), 0);
                    }
                }
                vm.stopPrank();

                for (uint256 j = 0; j < rewardToken.length; j++) {
                    assertApproxEqAbs(
                        rewardToken[j].balanceOf(account) + staker.pendingRewardsOf(rewardToken[j], account),
                        pendingRewards[randomIndex][j],
                        10**(decimalReward[j] - 4)
                    );
                }
            }

            // check on claimable rewards / added the Governor to just have an address with no stake --> should be 0
            address[5] memory allAccounts = [_alice, _bob, _charlie, _dylan, _hacker];
            for (uint256 k = 0; k < allAccounts.length; k++) {
                uint256[] memory prevRewardTokenBalance = new uint256[](rewardToken.length);
                uint256[] memory functionClaimableRewards = new uint256[](rewardToken.length);
                for (uint256 j = 0; j < rewardToken.length; j++) {
                    prevRewardTokenBalance[j] = rewardToken[j].balanceOf(allAccounts[k]);
                    functionClaimableRewards[j] = staker.claimableRewards(allAccounts[k], rewardToken[j]);
                }
                uint256[] memory claimedRewards = staker.claimRewards(allAccounts[k]);
                for (uint256 j = 0; j < rewardToken.length; j++) {
                    assertEq(functionClaimableRewards[j], claimedRewards[j]);
                    assertEq(
                        rewardToken[j].balanceOf(allAccounts[k]) - prevRewardTokenBalance[j],
                        functionClaimableRewards[j]
                    );
                    // Otherwise it has already been taken into account when deposit/withdraw
                    if (depositWithdrawRewards[i] % 3 == 2) pendingRewards[k][j] += functionClaimableRewards[j];

                    assertApproxEqAbs(
                        rewardToken[j].balanceOf(allAccounts[k]) +
                            staker.pendingRewardsOf(rewardToken[j], allAccounts[k]),
                        pendingRewards[k][j],
                        10**(decimalReward[j] - 4)
                    );
                }
            }
        }
    }

    // ================================== INTERNAL =================================

    function _depositRewards(uint256 amount) internal {
        amount = bound(amount, 0, 10_000_000 ether);
        deal(address(_CRV), address(baseRewardPool), type(uint256).max);
        // fake a non null incentives program on Convex
        vm.prank(address(convexBooster));
        baseRewardPool.queueNewRewards(amount);
    }

    function _rewardsToBeClaimed(IERC20 _rewardToken) internal view returns (uint256 amount) {
        amount = baseRewardPool.earned(address(staker));
        if (_rewardToken == IERC20(address(_CVX))) {
            // Computation made in the Convex token when claiming rewards check
            // https://etherscan.io/address/0x4e3fbd56cd56c3e72c1403e103b45db9da5b9d2b#code
            uint256 totalSupply = _CVX.totalSupply();
            uint256 cliff = totalSupply / _CVX.reductionPerCliff();
            uint256 totalCliffs = _CVX.totalCliffs();
            if (cliff < totalCliffs) {
                uint256 reduction = totalCliffs - cliff;
                amount = (amount * reduction) / totalCliffs;

                uint256 amtTillMax = _CVX.maxSupply() - totalSupply;
                if (amount > amtTillMax) {
                    amount = amtTillMax;
                }
            }
        }
    }
}
