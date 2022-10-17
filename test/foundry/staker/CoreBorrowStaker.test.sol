// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.12;

import "@openzeppelin/contracts-upgradeable/interfaces/IERC20MetadataUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import "../BaseTest.test.sol";
import "../../../contracts/interfaces/ICoreBorrow.sol";
import "../../../contracts/mock/MockTokenPermit.sol";
import { MockBorrowStaker, BorrowStakerStorage } from "../../../contracts/mock/MockBorrowStaker.sol";

contract CoreBorrowStakerTest is BaseTest {
    using stdStorage for StdStorage;

    MockTokenPermit public asset;
    MockTokenPermit public rewardToken;
    MockTokenPermit public otherToken;
    MockBorrowStaker public stakerImplementation;
    MockBorrowStaker public staker;
    uint8 public decimalToken = 18;
    uint8 public decimalReward = 6;
    uint256 public rewardAmount = 10**2 * 10**(decimalReward);
    uint256 public maxTokenAmount = 10**15 * 10**decimalToken;

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
    }

    // ================================= INITIALIZE ================================

    function testInitalizeStakerZeroAddress() public {
        vm.expectRevert(bytes("Address: low-level delegate call failed"));
        MockBorrowStaker(
            deployUpgradeable(
                address(stakerImplementation),
                abi.encodeWithSelector(stakerImplementation.initialize.selector, address(0))
            )
        );
    }

    function testInitalize() public {
        assertEq(staker.name(), "Angle agEUR Staker");
        assertEq(staker.symbol(), "agstk-agEUR");
        assertEq(address(staker.asset()), address(asset));
        assertEq(address(staker.coreBorrow()), address(coreBorrow));
    }

    // =============================== ACCESS CONTROL ==============================

    function testStakerAccessControlInvalid(
        address randomUser,
        uint256 amount,
        address newCoreBorrow
    ) public {
        vm.assume(randomUser != _GOVERNOR && randomUser != address(0) && newCoreBorrow != address(0));
        otherToken.mint(address(staker), amount);

        startHoax(randomUser);
        vm.expectRevert(BorrowStakerStorage.NotGovernor.selector);
        staker.recoverERC20(address(otherToken), address(randomUser), amount);

        vm.expectRevert(BorrowStakerStorage.NotGovernor.selector);
        staker.setCoreBorrow(ICoreBorrow(newCoreBorrow));
    }

    // =============================== SETCOREBORROW ===============================

    function testFailSetCoreBorrowNotAContract(ICoreBorrow newCoreBorrow) public {
        startHoax(_GOVERNOR);

        vm.expectRevert(bytes("EvmError: Revert"));
        staker.setCoreBorrow(ICoreBorrow(newCoreBorrow));
    }

    function testSetCoreBorrowNotAGovernor() public {
        startHoax(_GOVERNOR);

        MockCoreBorrow mockCore = new MockCoreBorrow();
        mockCore.toggleGuardian(_GUARDIAN);

        vm.expectRevert(BorrowStakerStorage.NotGovernor.selector);
        staker.setCoreBorrow(ICoreBorrow(mockCore));
    }

    function testSetCoreBorrowSuccess() public {
        startHoax(_GOVERNOR);

        MockCoreBorrow mockCore = new MockCoreBorrow();
        mockCore.toggleGovernor(_GOVERNOR);
        staker.setCoreBorrow(ICoreBorrow(mockCore));

        assertEq(address(mockCore), address(staker.coreBorrow()));
    }

    // ================================ RECOVERERC20 ===============================

    function testRecoverERC20InvalidToken(uint256 amount) public {
        deal(address(asset), address(staker), amount);

        vm.expectRevert(BorrowStakerStorage.InvalidToken.selector);
        vm.prank(_GOVERNOR);
        staker.recoverERC20(address(asset), _alice, amount);
    }

    function testRecoverERC20(uint256 amount) public {
        deal(address(otherToken), address(staker), amount);

        vm.prank(_GOVERNOR);
        staker.recoverERC20(address(otherToken), _alice, amount);
        assertEq(otherToken.balanceOf(_alice), amount);
    }

    // ================================== DEPOSIT ==================================

    function testDepositNoFunds(uint256 amount, address to) public {
        vm.assume(to != address(0));
        amount = bound(amount, 1, type(uint256).max);
        vm.prank(_alice);
        vm.expectRevert(bytes("ERC20: transfer amount exceeds balance"));
        staker.deposit(amount, to);
    }

    /// @dev This test will go through the totalSupply = 0 branches
    function testFirstDepositSuccess(uint256 amount, address to) public {
        vm.assume(to != address(0));
        deal(address(asset), address(_alice), amount);

        startHoax(_alice);
        asset.approve(address(staker), amount);
        staker.deposit(amount, to);

        assertEq(asset.balanceOf(_alice), 0);
        assertEq(staker.balanceOf(to), amount);
        assertEq(staker.integral(rewardToken), 0);
        assertEq(staker.integralOf(rewardToken, to), 0);
    }

    /// @dev This test will go through the totalSupply = 0 branches
    function testMultiDepositsSuccess(uint256[10] memory amounts, uint256[10] memory accounts) public {
        amounts[0] = bound(amounts[0], 1, maxTokenAmount);
        deal(address(asset), _alice, amounts[0]);
        vm.startPrank(_alice);
        asset.approve(address(staker), amounts[0]);
        staker.deposit(amounts[0], _alice);
        vm.stopPrank();

        uint256 totalSupply = amounts[0];
        uint256[4] memory balanceOf;
        uint256 integral;
        uint256[4] memory integralOf;
        uint256[4] memory pendingRewards;
        balanceOf[0] = amounts[0];

        for (uint256 i = 1; i < amounts.length; i++) {
            uint256 randomIndex = bound(accounts[i], 0, 3);
            address account = randomIndex == 0 ? _alice : randomIndex == 1 ? _bob : randomIndex == 2
                ? _charlie
                : _dylan;

            uint256 amount = bound(amounts[i], 1, maxTokenAmount);
            deal(address(asset), account, amount);
            deal(address(rewardToken), address(staker), rewardAmount * (i + 1));

            vm.startPrank(account);
            asset.approve(address(staker), amount);
            staker.deposit(amount, account);
            vm.stopPrank();

            integral += (rewardAmount * BASE_PARAMS) / totalSupply;
            uint256 newClaimable = (balanceOf[randomIndex] * (integral - integralOf[randomIndex])) / BASE_PARAMS;
            integralOf[randomIndex] = integral;
            totalSupply += amount;
            balanceOf[randomIndex] += amount;
            pendingRewards[randomIndex] += newClaimable;
            assertEq(asset.balanceOf(address(staker)), totalSupply);
            assertEq(staker.totalSupply(), totalSupply);
            assertEq(staker.integral(rewardToken), integral);
            assertEq(staker.balanceOf(_alice), balanceOf[0]);
            assertEq(staker.balanceOf(_bob), balanceOf[1]);
            assertEq(staker.balanceOf(_charlie), balanceOf[2]);
            assertEq(staker.balanceOf(_dylan), balanceOf[3]);
            assertEq(staker.pendingRewardsOf(rewardToken, _alice), pendingRewards[0]);
            assertEq(staker.pendingRewardsOf(rewardToken, _bob), pendingRewards[1]);
            assertEq(staker.pendingRewardsOf(rewardToken, _charlie), pendingRewards[2]);
            assertEq(staker.pendingRewardsOf(rewardToken, _dylan), pendingRewards[3]);
        }
    }

    /// @dev This test will go through the totalSupply = 0 branches
    function testMultiDepositsRewardsSuccess(uint256[2] memory amounts, uint256[2] memory accounts) public {
        amounts[0] = bound(amounts[0], 1, 10**35);
        deal(address(asset), _alice, amounts[0]);
        vm.startPrank(_alice);
        asset.approve(address(staker), amounts[0]);
        staker.deposit(amounts[0], _alice);
        vm.stopPrank();

        uint256[4] memory pendingRewards;

        for (uint256 i = 1; i < amounts.length; i++) {
            uint256 randomIndex = bound(accounts[i], 0, 3);
            address account = randomIndex == 0 ? _alice : randomIndex == 1 ? _bob : randomIndex == 2
                ? _charlie
                : _dylan;

            uint256 amount = bound(amounts[i], 1, 10**35);
            deal(address(asset), account, amount);
            deal(address(rewardToken), address(staker), rewardAmount * (i + 1));

            pendingRewards[0] += (staker.balanceOf(_alice) * rewardAmount) / staker.totalSupply();
            pendingRewards[1] += (staker.balanceOf(_bob) * rewardAmount) / staker.totalSupply();
            pendingRewards[2] += (staker.balanceOf(_charlie) * rewardAmount) / staker.totalSupply();
            pendingRewards[3] += (staker.balanceOf(_dylan) * rewardAmount) / staker.totalSupply();

            vm.startPrank(account);
            asset.approve(address(staker), amount);
            staker.deposit(amount, account);
            vm.stopPrank();

            console.log("rewards Alice", staker.pendingRewardsOf(rewardToken, _alice));
            console.log("rewards Bob", staker.pendingRewardsOf(rewardToken, _bob));
            console.log("rewards Charlie", staker.pendingRewardsOf(rewardToken, _charlie));
            console.log("rewards Dylan", staker.pendingRewardsOf(rewardToken, _dylan));

            assertApproxEqAbs(
                staker.pendingRewardsOf(rewardToken, account),
                pendingRewards[randomIndex],
                10**(decimalReward - 4)
            );
        }
    }
}
