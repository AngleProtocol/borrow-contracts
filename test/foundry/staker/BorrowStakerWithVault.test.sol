// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.12;

import "@openzeppelin/contracts-upgradeable/interfaces/IERC20MetadataUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import "../BaseTest.test.sol";
import "../../../contracts/interfaces/ICoreBorrow.sol";
import "../../../contracts/mock/MockTokenPermit.sol";
import "../../../contracts/mock/MockVaultManager.sol";
import { MockBorrowStaker, BorrowStakerStorage } from "../../../contracts/mock/MockBorrowStaker.sol";

contract BorrowStakerWithVaultTest is BaseTest {
    using stdStorage for StdStorage;

    MockTokenPermit public asset;
    MockTokenPermit public rewardToken;
    MockTokenPermit public otherToken;
    MockBorrowStaker public stakerImplementation;
    MockBorrowStaker public staker;
    MockVaultManagerListing[] public vaultManagers;
    uint256[] public currentVaultID = [1, 1];

    uint8 public decimalToken = 18;
    uint8 public decimalReward = 6;
    uint256 public rewardAmount = 10**2 * 10**(decimalReward);
    uint256 public maxTokenAmount = 10**15 * 10**decimalToken;

    uint256 public constant BALANCEOF_LENGTH = 50;
    uint256 public constant WITHDRAW_LENGTH = 50;
    uint256 public constant CLAIM_LENGTH = 50;

    function setUp() public override {
        super.setUp();
        asset = new MockTokenPermit("agEUR", "agEUR", decimalToken);
        rewardToken = new MockTokenPermit("reward", "rwrd", decimalReward);
        otherToken = new MockTokenPermit("other", "other", 18);
        stakerImplementation = new MockBorrowStaker();
        staker = MockBorrowStaker(
            deployUpgradeable(
                address(stakerImplementation),
                abi.encodeWithSelector(staker.initialize.selector, coreBorrow, asset)
            )
        );

        staker.setRewardToken(rewardToken);
        staker.setRewardAmount(rewardAmount);

        // set up fake vaultManager
        address _treasury = address(uint160(uint256(keccak256(abi.encodePacked("treasury")))));
        vaultManagers = new MockVaultManagerListing[](2);
        vaultManagers[0] = new MockVaultManagerListing(_treasury);
        vaultManagers[1] = new MockVaultManagerListing(_treasury);
        vaultManagers[0].setParams(_GOVERNOR, address(asset), address(otherToken), 1 ether, 0, BASE_PARAMS / 2, 0);
        vaultManagers[1].setParams(_GOVERNOR, address(asset), address(rewardToken), 1 ether, 0, BASE_PARAMS / 4, 0);
        vm.startPrank(_GOVERNOR);
        staker.addVaultManager(IVaultManagerListing(address(vaultManagers[0])));
        staker.addVaultManager(IVaultManagerListing(address(vaultManagers[1])));
        vm.stopPrank();
    }

    // =============================== TOTALBALANCEOF ==============================

    function testBalanceOfSuccess(
        uint256[BALANCEOF_LENGTH] memory whichVault,
        uint256[BALANCEOF_LENGTH] memory amounts,
        uint256[BALANCEOF_LENGTH] memory vaultIdToWithdraw,
        uint256[BALANCEOF_LENGTH] memory propVault,
        bool[BALANCEOF_LENGTH] memory isDeposit,
        uint256[BALANCEOF_LENGTH] memory accounts
    ) public {
        uint256[4] memory realBalances;

        // we don't care about the rewards here
        staker.setRewardAmount(0);

        amounts[0] = bound(amounts[0], 1, maxTokenAmount);
        deal(address(asset), _alice, amounts[0]);
        vm.startPrank(_alice);
        asset.approve(address(staker), amounts[0]);
        staker.deposit(amounts[0], _alice);
        realBalances[0] += amounts[0];
        vm.stopPrank();
        // directly put it on a vaultManager
        _fakeDepositVault(0, _alice, amounts[0]);

        for (uint256 i = 1; i < amounts.length; i++) {
            uint256 randomIndex = bound(accounts[i], 0, 3);
            address account = randomIndex == 0 ? _alice : randomIndex == 1 ? _bob : randomIndex == 2
                ? _charlie
                : _dylan;
            uint256 vaultNum = bound(whichVault[i], 0, 1);

            if (
                vaultManagers[vaultNum].getUserVaults(account).length == 0 ||
                staker.balanceOf(account) + _userTotalCollatOnVaultManager(vaultNum, account) == 0
            ) isDeposit[i] = true;

            uint256 amount;
            vm.startPrank(account);
            if (isDeposit[i]) {
                amount = bound(amounts[i], 1, maxTokenAmount);
                propVault[i] = bound(propVault[i], 0, BASE_PARAMS);
                deal(address(asset), account, amount);
                asset.approve(address(staker), amount);
                staker.deposit(amount, account);
                realBalances[randomIndex] += amount;
                vm.stopPrank();
                _fakeDepositVault(vaultNum, account, (amount * propVault[i]) / BASE_PARAMS);
            } else {
                amount = bound(amounts[i], 1, BASE_PARAMS);
                propVault[i] = bound(propVault[i], 0, BASE_PARAMS);
                uint256[] memory vaultIDs = vaultManagers[vaultNum].getUserVaults(account);
                vaultIdToWithdraw[i] = bound(vaultIdToWithdraw[i], 0, vaultIDs.length - 1);
                uint256 withdrawnDirectly = (amount * staker.balanceOf(account)) / BASE_PARAMS;
                staker.withdraw(withdrawnDirectly, account, account);
                vm.stopPrank();
                uint256 withdrawnVault = _fakeWithdrawVault(
                    vaultNum,
                    vaultIDs[vaultIdToWithdraw[i]],
                    account,
                    propVault[i]
                );
                realBalances[randomIndex] = realBalances[randomIndex] - withdrawnDirectly;
            }

            assertEq(staker.totalBalanceOf(account), realBalances[randomIndex]);
        }
    }

    // ============================= DEPOSIT / WITHDRAW ============================

    function testMultiWithdrawRewardsSuccess(
        uint256[WITHDRAW_LENGTH] memory whichVault,
        uint256[WITHDRAW_LENGTH] memory amounts,
        uint256[WITHDRAW_LENGTH] memory vaultIdToWithdraw,
        uint256[WITHDRAW_LENGTH] memory propVault,
        bool[WITHDRAW_LENGTH] memory isDeposit,
        uint256[WITHDRAW_LENGTH] memory accounts
    ) public {
        uint256[4] memory realBalances;
        uint256[4] memory pendingRewards;

        deal(address(rewardToken), address(staker), rewardAmount * (amounts.length));

        amounts[0] = bound(amounts[0], 1, maxTokenAmount);
        deal(address(asset), _alice, amounts[0]);
        vm.startPrank(_alice);
        asset.approve(address(staker), amounts[0]);
        staker.deposit(amounts[0], _alice);
        realBalances[0] += amounts[0];
        vm.stopPrank();
        // directly put it on a vaultManager
        _fakeDepositVault(0, _alice, amounts[0]);

        for (uint256 i = 1; i < amounts.length; i++) {
            uint256 randomIndex = bound(accounts[i], 0, 3);
            address account = randomIndex == 0 ? _alice : randomIndex == 1 ? _bob : randomIndex == 2
                ? _charlie
                : _dylan;
            uint256 vaultNum = bound(whichVault[i], 0, 1);

            if (
                vaultManagers[vaultNum].getUserVaults(account).length == 0 ||
                staker.balanceOf(account) + _userTotalCollatOnVaultManager(vaultNum, account) == 0
            ) isDeposit[i] = true;

            {
                uint256 totSupply = staker.totalSupply();
                if (totSupply > 0) {
                    pendingRewards[0] += (staker.totalBalanceOf(_alice) * rewardAmount) / staker.totalSupply();
                    pendingRewards[1] += (staker.totalBalanceOf(_bob) * rewardAmount) / staker.totalSupply();
                    pendingRewards[2] += (staker.totalBalanceOf(_charlie) * rewardAmount) / staker.totalSupply();
                    pendingRewards[3] += (staker.totalBalanceOf(_dylan) * rewardAmount) / staker.totalSupply();
                }
            }

            uint256 amount;
            vm.startPrank(account);
            if (isDeposit[i]) {
                amount = bound(amounts[i], 1, maxTokenAmount);
                propVault[i] = bound(propVault[i], 0, BASE_PARAMS);
                deal(address(asset), account, amount);
                asset.approve(address(staker), amount);
                uint256 prevRewardTokenBalance = rewardToken.balanceOf(account);
                staker.deposit(amount, account);
                realBalances[randomIndex] += amount;
                vm.stopPrank();
                assertEq(rewardToken.balanceOf(account), prevRewardTokenBalance);
                _fakeDepositVault(vaultNum, account, (amount * propVault[i]) / BASE_PARAMS);
                assertEq(staker.pendingRewardsOf(rewardToken, account), 0);
            } else {
                amount = bound(amounts[i], 1, BASE_PARAMS);
                propVault[i] = bound(propVault[i], 0, BASE_PARAMS);
                uint256[] memory vaultIDs = vaultManagers[vaultNum].getUserVaults(account);
                vaultIdToWithdraw[i] = bound(vaultIdToWithdraw[i], 0, vaultIDs.length - 1);
                uint256 withdrawnDirectly = (amount * staker.balanceOf(account)) / BASE_PARAMS;
                staker.withdraw(withdrawnDirectly, account, account);
                vm.stopPrank();
                _fakeWithdrawVault(vaultNum, vaultIDs[vaultIdToWithdraw[i]], account, propVault[i]);

                realBalances[randomIndex] = realBalances[randomIndex] - withdrawnDirectly;
                assertEq(staker.pendingRewardsOf(rewardToken, account), 0);
            }

            assertEq(staker.totalBalanceOf(account), realBalances[randomIndex]);
            assertApproxEqAbs(
                rewardToken.balanceOf(account) + staker.pendingRewardsOf(rewardToken, account),
                pendingRewards[randomIndex],
                10**(decimalReward - 4)
            );
        }
    }

    // ================================ CLAIMREWARDS ===============================

    function testClaimRewardsSuccess(
        uint256[CLAIM_LENGTH] memory whichVault,
        uint256[CLAIM_LENGTH] memory amounts,
        uint256[CLAIM_LENGTH] memory vaultIdToWithdraw,
        uint256[CLAIM_LENGTH] memory propVault,
        bool[CLAIM_LENGTH] memory isDeposit,
        uint256[CLAIM_LENGTH] memory accounts
    ) public {
        uint256[4] memory pendingRewards;

        deal(address(rewardToken), address(staker), rewardAmount * (amounts.length));

        amounts[0] = bound(amounts[0], 1, maxTokenAmount);
        deal(address(asset), _alice, amounts[0]);
        vm.startPrank(_alice);
        asset.approve(address(staker), amounts[0]);
        staker.deposit(amounts[0], _alice);
        vm.stopPrank();
        // directly put it on a vaultManager
        _fakeDepositVault(0, _alice, amounts[0]);

        for (uint256 i = 1; i < amounts.length; i++) {
            staker.setRewardAmount(rewardAmount);
            uint256 randomIndex = bound(accounts[i], 0, 3);
            address account = randomIndex == 0 ? _alice : randomIndex == 1 ? _bob : randomIndex == 2
                ? _charlie
                : _dylan;
            uint256 vaultNum = bound(whichVault[i], 0, 1);

            if (
                vaultManagers[vaultNum].getUserVaults(account).length == 0 ||
                staker.balanceOf(account) + _userTotalCollatOnVaultManager(vaultNum, account) == 0
            ) isDeposit[i] = true;

            {
                uint256 totSupply = staker.totalSupply();
                if (totSupply > 0) {
                    pendingRewards[0] += (staker.totalBalanceOf(_alice) * rewardAmount) / staker.totalSupply();
                    pendingRewards[1] += (staker.totalBalanceOf(_bob) * rewardAmount) / staker.totalSupply();
                    pendingRewards[2] += (staker.totalBalanceOf(_charlie) * rewardAmount) / staker.totalSupply();
                    pendingRewards[3] += (staker.totalBalanceOf(_dylan) * rewardAmount) / staker.totalSupply();
                }
            }

            uint256 amount;
            vm.startPrank(account);
            if (isDeposit[i]) {
                amount = bound(amounts[i], 1, maxTokenAmount);
                propVault[i] = bound(propVault[i], 0, BASE_PARAMS);
                deal(address(asset), account, amount);
                asset.approve(address(staker), amount);
                uint256 prevRewardTokenBalance = rewardToken.balanceOf(account);
                staker.deposit(amount, account);
                vm.stopPrank();
                // to disable new rewards when calling `claimableRewards` and `claimRewards`
                staker.setRewardAmount(0);
                uint256 functionClaimableRewards = staker.claimableRewards(account, rewardToken);
                uint256[] memory claimedRewards = staker.claimRewards(account);
                assertEq(functionClaimableRewards, claimedRewards[0]);
                assertEq(rewardToken.balanceOf(account) - prevRewardTokenBalance, functionClaimableRewards);

                _fakeDepositVault(vaultNum, account, (amount * propVault[i]) / BASE_PARAMS);
                assertEq(staker.pendingRewardsOf(rewardToken, account), 0);
            } else {
                amount = bound(amounts[i], 1, BASE_PARAMS);
                propVault[i] = bound(propVault[i], 0, BASE_PARAMS);
                uint256[] memory vaultIDs = vaultManagers[vaultNum].getUserVaults(account);
                vaultIdToWithdraw[i] = bound(vaultIdToWithdraw[i], 0, vaultIDs.length - 1);
                uint256 withdrawnDirectly = (amount * staker.balanceOf(account)) / BASE_PARAMS;
                staker.withdraw(withdrawnDirectly, account, account);
                vm.stopPrank();
                // to disable new rewards when calling `claimableRewards` and `claimRewards`
                staker.setRewardAmount(0);
                {
                    uint256 prevRewardTokenBalance = rewardToken.balanceOf(account);
                    uint256 functionClaimableRewards = staker.claimableRewards(account, rewardToken);
                    {
                        uint256[] memory claimedRewards = staker.claimRewards(account);
                        assertEq(functionClaimableRewards, claimedRewards[0]);
                    }
                    assertEq(rewardToken.balanceOf(account) - prevRewardTokenBalance, functionClaimableRewards);
                }
                _fakeWithdrawVault(vaultNum, vaultIDs[vaultIdToWithdraw[i]], account, propVault[i]);
            }

            assertApproxEqAbs(
                rewardToken.balanceOf(account) + staker.pendingRewardsOf(rewardToken, account),
                pendingRewards[randomIndex],
                10**(decimalReward - 4)
            );
        }
    }

    // ============================= INTERNAL FUNCTIONS ============================

    function _fakeDepositVault(
        uint256 vaultNum,
        address owner,
        uint256 amount
    ) internal {
        // to disable new rewards when calling `transfer` in `_beforeTokenTransfer`
        uint256 prevReward = staker.rewardAmount();
        staker.setRewardAmount(0);
        vm.startPrank(owner);
        staker.transfer(address(vaultManagers[vaultNum]), amount);
        vaultManagers[vaultNum].setOwner(currentVaultID[vaultNum], owner);
        vaultManagers[vaultNum].setVaultData(0, amount, currentVaultID[vaultNum]);
        currentVaultID[vaultNum] += 1;
        vm.stopPrank();
        staker.setRewardAmount(prevReward);
    }

    function _fakeWithdrawVault(
        uint256 vaultNum,
        uint256 vaultID,
        address owner,
        uint256 proportion
    ) internal returns (uint256 toWithdraw) {
        // to disable new rewards when calling `transfer` in `_beforeTokenTransfer`
        uint256 prevReward = staker.rewardAmount();
        staker.setRewardAmount(0);
        (uint256 currentCollateralAmount, ) = vaultManagers[vaultNum].vaultData(vaultID);
        vm.startPrank(address(vaultManagers[vaultNum]));
        toWithdraw = (currentCollateralAmount * proportion) / BASE_PARAMS;
        staker.transfer(owner, toWithdraw);
        vaultManagers[vaultNum].setVaultData(0, currentCollateralAmount - toWithdraw, vaultID);
        vm.stopPrank();
        staker.setRewardAmount(prevReward);
    }

    function _userTotalCollatOnVaultManager(uint256 vaultNum, address owner)
        internal
        view
        returns (uint256 amountOnVault)
    {
        uint256[] memory vaultIDs = vaultManagers[vaultNum].getUserVaults(owner);
        for (uint256 i; i < vaultIDs.length; i++) {
            (uint256 currentCollateralAmount, ) = vaultManagers[vaultNum].vaultData(vaultIDs[i]);
            amountOnVault += currentCollateralAmount;
        }
    }
}
