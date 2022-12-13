// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.12;

import "../BaseTest.test.sol";
import "../../../contracts/interfaces/ICoreBorrow.sol";
import "../../../contracts/mock/MockTokenPermit.sol";
import "../../../contracts/mock/MockVaultManager.sol";
import { ILiquidityGauge } from "../../../contracts/interfaces/coreModule/ILiquidityGauge.sol";
import { MockLiquidityGauge } from "../../../contracts/mock/MockLiquidityGauge.sol";
import { MockSanTokenERC4626AdapterStakable, SanTokenERC4626Adapter, ERC20Upgradeable } from "../../../contracts/mock/MockSanTokenERC4626Adapter.sol";
import { MockStableMasterSanWrapper } from "../../../contracts/mock/MockStableMaster.sol";

contract SanTokenERC4626AdapterStakableTest is BaseTest {
    using stdStorage for StdStorage;

    MockTokenPermit public token;
    MockTokenPermit public sanToken;
    MockSanTokenERC4626AdapterStakable public sanTokenAdapterImplementation;
    MockSanTokenERC4626AdapterStakable public sanTokenAdapter;
    MockStableMasterSanWrapper public stableMaster;
    MockLiquidityGauge public gauge;
    uint256 internal constant _BASE = 10**18;
    uint8 public decimalToken = 18;
    uint8 public decimalReward = 18;
    uint256 public maxTokenAmount = 10**12 * 10**decimalToken;
    uint256 public maxRewardAmount = 10**7 * 10**decimalReward;
    uint256 public maxLockedInterest = 10**6 * 10**decimalToken;
    uint256 public maxInterestDistributed = 10**4 * 10**decimalToken;

    uint256 public constant WITHDRAW_LENGTH = 30;
    uint256 public constant CLAIM_LENGTH = 30;

    function setUp() public override {
        super.setUp();

        _ethereum = vm.createFork(vm.envString("ETH_NODE_URI_MAINNET"), 15824909);
        vm.selectFork(_ethereum);

        token = new MockTokenPermit("DAI", "DAI", decimalToken);
        sanToken = new MockTokenPermit("sanDAI", "sanDAI", decimalToken);
        gauge = new MockLiquidityGauge("gauge", "GAU", address(sanToken));
        stableMaster = new MockStableMasterSanWrapper();
        sanTokenAdapterImplementation = new MockSanTokenERC4626AdapterStakable();
        sanTokenAdapter = MockSanTokenERC4626AdapterStakable(
            deployUpgradeable(
                address(sanTokenAdapterImplementation),
                abi.encodeWithSelector(sanTokenAdapter.setStableMaster.selector, address(stableMaster))
            )
        );
        sanTokenAdapter.setSanToken(address(sanToken));
        sanTokenAdapter.setAsset(address(token));
        sanTokenAdapter.setPoolManager(address(stableMaster));
        sanTokenAdapter.setLiquidityGauge(address(gauge));
        sanTokenAdapter.initialize();

        stableMaster.setPoolManagerToken(address(stableMaster), address(token));
        stableMaster.setPoolManagerSanToken(address(stableMaster), address(sanToken));
        stableMaster.setSanRate(address(stableMaster), _BASE);
        stableMaster.setSLPData(address(stableMaster), 0, maxInterestDistributed, 0);

        vm.startPrank(_GOVERNOR);
        vm.stopPrank();
    }

    // ============================= DEPOSIT / WITHDRAW ============================

    function testMultiWithdrawRewardsSuccess(
        uint256[WITHDRAW_LENGTH] memory amounts,
        uint256[WITHDRAW_LENGTH] memory rewardAmounts,
        bool[WITHDRAW_LENGTH] memory isDeposit,
        uint256[WITHDRAW_LENGTH] memory accounts,
        uint64[WITHDRAW_LENGTH] memory elapseTime
    ) public {
        uint256[4] memory pendingRewards;

        for (uint256 i = 1; i < amounts.length; ++i) {
            uint256 randomIndex = bound(accounts[i], 0, 3);
            address account = randomIndex == 0 ? _alice : randomIndex == 1 ? _bob : randomIndex == 2
                ? _charlie
                : _dylan;
            if (sanTokenAdapter.balanceOf(account) == 0) isDeposit[i] = true;

            uint256 rewardAmount = bound(rewardAmounts[i], 0, maxRewardAmount);
            _depositRewards(rewardAmount, address(sanTokenAdapter));
            {
                uint256 totSupply = sanTokenAdapter.totalSupply();
                if (totSupply > 0) {
                    pendingRewards[0] += (sanTokenAdapter.balanceOf(_alice) * rewardAmount) / totSupply;
                    pendingRewards[1] += (sanTokenAdapter.balanceOf(_bob) * rewardAmount) / totSupply;
                    pendingRewards[2] += (sanTokenAdapter.balanceOf(_charlie) * rewardAmount) / totSupply;
                    pendingRewards[3] += (sanTokenAdapter.balanceOf(_dylan) * rewardAmount) / totSupply;
                }
            }

            uint256 amount;
            vm.startPrank(account);
            if (isDeposit[i]) {
                amount = bound(amounts[i], 1, maxTokenAmount);
                deal(address(token), account, amount);
                token.approve(address(sanTokenAdapter), amount);

                uint256 prevRewardTokenBalance = IERC20(_ANGLE).balanceOf(account);
                sanTokenAdapter.deposit(amount, account);
                assertEq(IERC20(_ANGLE).balanceOf(account), prevRewardTokenBalance);
            } else {
                amount = bound(amounts[i], 1, BASE_PARAMS);
                amount = (amount * sanTokenAdapter.maxWithdraw(account)) / BASE_PARAMS;
                sanTokenAdapter.withdraw(amount, account, account);
                assertEq(sanTokenAdapter.pendingRewardsOf(IERC20(_ANGLE), account), 0);
            }
            vm.stopPrank();

            assertApproxEqAbs(
                IERC20(_ANGLE).balanceOf(account) + sanTokenAdapter.pendingRewardsOf(IERC20(_ANGLE), account),
                pendingRewards[randomIndex],
                10**(decimalReward - 4)
            );

            // advance in time for rewards to be taken into account
            elapseTime[i] = uint64(bound(elapseTime[i], 1, 86400 * 7));
            vm.warp(block.timestamp + elapseTime[i]);
        }
    }

    // ================================ CLAIMREWARDS ===============================

    function testClaimRewardsSuccess(
        uint256[CLAIM_LENGTH] memory amounts,
        uint256[CLAIM_LENGTH] memory rewardAmounts,
        bool[CLAIM_LENGTH] memory isDeposit,
        uint256[CLAIM_LENGTH] memory accounts,
        uint64[CLAIM_LENGTH] memory elapseTime
    ) public {
        uint256[4] memory pendingRewards;
        for (uint256 i = 1; i < amounts.length; ++i) {
            elapseTime[i] = uint64(bound(elapseTime[i], 1, 86400 * 7));
            uint256 randomIndex = bound(accounts[i], 0, 3);
            address account = randomIndex == 0 ? _alice : randomIndex == 1 ? _bob : randomIndex == 2
                ? _charlie
                : _dylan;
            if (sanTokenAdapter.balanceOf(account) == 0) isDeposit[i] = true;

            uint256 rewardAmount = bound(rewardAmounts[i], 0, maxRewardAmount);
            _depositRewards(rewardAmount, address(sanTokenAdapter));
            {
                uint256 totSupply = sanTokenAdapter.totalSupply();
                if (totSupply > 0) {
                    pendingRewards[0] += (sanTokenAdapter.balanceOf(_alice) * rewardAmount) / totSupply;
                    pendingRewards[1] += (sanTokenAdapter.balanceOf(_bob) * rewardAmount) / totSupply;
                    pendingRewards[2] += (sanTokenAdapter.balanceOf(_charlie) * rewardAmount) / totSupply;
                    pendingRewards[3] += (sanTokenAdapter.balanceOf(_dylan) * rewardAmount) / totSupply;
                }
            }

            uint256 amount;
            vm.startPrank(account);
            if (isDeposit[i]) {
                amount = bound(amounts[i], 1, maxTokenAmount);
                deal(address(token), account, amount);
                uint256 prevRewardTokenBalance = IERC20(_ANGLE).balanceOf(account);
                token.approve(address(sanTokenAdapter), amount);
                sanTokenAdapter.deposit(amount, account);

                uint256 functionClaimableRewards = sanTokenAdapter.claimableRewards(account, IERC20(_ANGLE));
                uint256[] memory claimedRewards = sanTokenAdapter.claim_rewards(account);
                assertEq(functionClaimableRewards, claimedRewards[0]);
                assertEq(IERC20(_ANGLE).balanceOf(account) - prevRewardTokenBalance, functionClaimableRewards);
            } else {
                amount = bound(amounts[i], 1, BASE_PARAMS);
                amount = (amount * sanTokenAdapter.maxWithdraw(account)) / BASE_PARAMS;
                sanTokenAdapter.withdraw(amount, account, account);

                uint256 prevRewardTokenBalance = IERC20(_ANGLE).balanceOf(account);
                uint256 functionClaimableRewards = sanTokenAdapter.claimableRewards(account, IERC20(_ANGLE));
                // Testing the claimRewards function this time
                uint256[] memory claimedRewards = sanTokenAdapter.claim_rewards(account);
                assertEq(functionClaimableRewards, claimedRewards[0]);
                assertEq(IERC20(_ANGLE).balanceOf(account) - prevRewardTokenBalance, functionClaimableRewards);
            }

            vm.stopPrank();

            assertApproxEqAbs(
                IERC20(_ANGLE).balanceOf(account) + sanTokenAdapter.pendingRewardsOf(IERC20(_ANGLE), account),
                pendingRewards[randomIndex],
                10**(decimalReward - 4)
            );

            // advance in time for rewards to be taken into account
            vm.warp(block.timestamp + elapseTime[i]);
        }
    }

    // ================================== INTERNAL =================================

    function _depositRewards(uint256 amount, address receiver) internal {
        deal(_ANGLE, address(gauge), amount + IERC20(_ANGLE).balanceOf(address(gauge)));
        gauge.setReward(receiver, amount);
    }
}
