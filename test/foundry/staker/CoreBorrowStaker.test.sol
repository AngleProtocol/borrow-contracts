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

    uint256 public constant depositLengthArray = 10;
    uint256 public constant withdrawLengthArray = 10;
    uint256 public constant claimableRewardsLengthArray = 50;
    uint256 public constant claimRewardsLengthArray = 50;

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

    function testMultiDepositsRewardsSuccess(
        uint256[depositLengthArray] memory amounts,
        uint256[depositLengthArray] memory accounts
    ) public {
        amounts[0] = bound(amounts[0], 1, maxTokenAmount);
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

            uint256 amount = bound(amounts[i], 1, maxTokenAmount);
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

            assertApproxEqAbs(
                staker.pendingRewardsOf(rewardToken, account),
                pendingRewards[randomIndex],
                10**(decimalReward - 4)
            );
        }
    }

    // ================================== WITHDRAW =================================

    function testWithdrawNoStakes(uint256 amount, address to) public {
        vm.assume(to != address(0));
        amount = bound(amount, 1, type(uint256).max);
        vm.prank(_alice);
        vm.expectRevert(bytes("ERC20: burn amount exceeds balance"));
        staker.withdraw(amount, _alice, to);
    }

    /// @dev This test will go through the totalSupply = 0 branches
    function testFirstWithdrawAllowanceLow(
        uint256 amount,
        uint256 allowance,
        address to
    ) public {
        vm.assume(to != address(0) && to != _alice);
        amount = bound(amount, 1, maxTokenAmount);
        allowance = bound(allowance, 0, 10**9 - 1);
        deal(address(asset), address(_alice), amount);
        deal(address(rewardToken), address(staker), rewardAmount);

        vm.prank(_alice);
        asset.approve(address(staker), amount);
        vm.prank(_alice);
        staker.deposit(amount, to);
        vm.prank(to);
        staker.approve(_alice, (allowance * amount) / 10**9);
        vm.prank(_alice);
        vm.expectRevert(BorrowStakerStorage.TransferAmountExceedsAllowance.selector);
        staker.withdraw(amount, to, _alice);
    }

    /// @dev This test will go through the totalSupply = 0 branches
    function testFirstWithdrawSuccess(uint256 amount, address to) public {
        vm.assume(to != address(0));
        amount = bound(amount, 0, maxTokenAmount);
        deal(address(asset), address(_alice), amount);
        deal(address(rewardToken), address(staker), rewardAmount);

        startHoax(_alice);
        asset.approve(address(staker), amount);
        staker.deposit(amount, _alice);
        staker.withdraw(amount, _alice, to);

        assertEq(asset.balanceOf(_alice), 0);
        assertEq(asset.balanceOf(to), amount);
        assertEq(staker.balanceOf(_alice), 0);
        assertEq(staker.balanceOf(to), 0);
        assertEq(staker.pendingRewardsOf(rewardToken, _alice), 0);
        assertEq(staker.pendingRewardsOf(rewardToken, to), 0);
        assertEq(rewardToken.balanceOf(to), 0);
        assertApproxEqAbs(rewardToken.balanceOf(_alice), amount > 0 ? rewardAmount : 0, 10**(decimalReward - 4));
    }

    function testFirstWithdrawFullAllowanceSuccess(uint256 amount, address to) public {
        vm.assume(to != address(0) && to != _alice);
        amount = bound(amount, 1, maxTokenAmount);
        deal(address(asset), address(_alice), amount);
        deal(address(rewardToken), address(staker), rewardAmount);

        vm.startPrank(_alice);
        asset.approve(address(staker), amount);
        staker.deposit(amount, _alice);
        staker.approve(to, type(uint256).max);
        vm.stopPrank();
        vm.prank(to);
        staker.withdraw(amount, _alice, to);

        assertEq(staker.allowance(_alice, to), type(uint256).max);
        assertEq(asset.balanceOf(_alice), 0);
        assertEq(asset.balanceOf(to), amount);
        assertEq(staker.balanceOf(_alice), 0);
        assertEq(staker.balanceOf(to), 0);
        assertEq(staker.pendingRewardsOf(rewardToken, _alice), 0);
        assertEq(staker.pendingRewardsOf(rewardToken, to), 0);
        assertEq(rewardToken.balanceOf(to), 0);
        assertApproxEqAbs(rewardToken.balanceOf(_alice), amount > 0 ? rewardAmount : 0, 10**(decimalReward - 4));
    }

    function testFirstWithdrawPartialAllowanceSuccess(
        uint256 amount,
        uint256 allowance,
        address to
    ) public {
        vm.assume(to != address(0) && to != _alice);
        amount = bound(amount, 10**4, maxTokenAmount);
        allowance = bound(allowance, 10**9, 10**11);
        deal(address(asset), address(_alice), amount);
        deal(address(rewardToken), address(staker), rewardAmount);

        vm.startPrank(_alice);
        asset.approve(address(staker), amount);
        staker.deposit(amount, _alice);
        staker.approve(to, (amount * allowance) / 10**9);
        vm.stopPrank();
        vm.prank(to);
        staker.withdraw(amount, _alice, to);

        assertEq(staker.allowance(_alice, to), (amount * allowance) / 10**9 - amount);
        assertEq(asset.balanceOf(_alice), 0);
        assertEq(asset.balanceOf(to), amount);
        assertEq(staker.balanceOf(_alice), 0);
        assertEq(staker.balanceOf(to), 0);
        assertEq(staker.pendingRewardsOf(rewardToken, _alice), 0);
        assertEq(staker.pendingRewardsOf(rewardToken, to), 0);
        assertEq(rewardToken.balanceOf(to), 0);
        assertApproxEqAbs(rewardToken.balanceOf(_alice), amount > 0 ? rewardAmount : 0, 10**(decimalReward - 4));
    }

    function testMultiWithdrawRewardsSuccess(
        uint256[withdrawLengthArray] memory amounts,
        bool[withdrawLengthArray] memory isDeposit,
        uint256[withdrawLengthArray] memory accounts
    ) public {
        deal(address(rewardToken), address(staker), rewardAmount * (amounts.length));

        amounts[0] = bound(amounts[0], 1, maxTokenAmount);
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
            if (staker.balanceOf(account) == 0) isDeposit[i] = true;

            {
                uint256 totSupply = staker.totalSupply();
                if (totSupply > 0) {
                    pendingRewards[0] += (staker.balanceOf(_alice) * rewardAmount) / staker.totalSupply();
                    pendingRewards[1] += (staker.balanceOf(_bob) * rewardAmount) / staker.totalSupply();
                    pendingRewards[2] += (staker.balanceOf(_charlie) * rewardAmount) / staker.totalSupply();
                    pendingRewards[3] += (staker.balanceOf(_dylan) * rewardAmount) / staker.totalSupply();
                }
            }

            uint256 amount;
            vm.startPrank(account);
            if (isDeposit[i]) {
                amount = bound(amounts[i], 1, maxTokenAmount);
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
    }

    // ============================== CLAIMABLEREWARDS =============================

    function testClaimableRewardsSuccess(
        uint256[claimableRewardsLengthArray] memory amounts,
        bool[claimableRewardsLengthArray] memory isDeposit,
        uint256[claimableRewardsLengthArray] memory accounts
    ) public {
        deal(address(rewardToken), address(staker), rewardAmount * (amounts.length));

        amounts[0] = bound(amounts[0], 1, maxTokenAmount);
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
            if (staker.balanceOf(account) == 0) isDeposit[i] = true;

            {
                uint256 totSupply = staker.totalSupply();
                if (totSupply > 0) {
                    pendingRewards[0] += (staker.balanceOf(_alice) * rewardAmount) / staker.totalSupply();
                    pendingRewards[1] += (staker.balanceOf(_bob) * rewardAmount) / staker.totalSupply();
                    pendingRewards[2] += (staker.balanceOf(_charlie) * rewardAmount) / staker.totalSupply();
                    pendingRewards[3] += (staker.balanceOf(_dylan) * rewardAmount) / staker.totalSupply();
                }
            }

            uint256 amount;
            vm.startPrank(account);
            if (isDeposit[i]) {
                amount = bound(amounts[i], 1, maxTokenAmount);
                deal(address(asset), account, amount);
                asset.approve(address(staker), amount);

                uint256 prevRewardTokenBalance = rewardToken.balanceOf(account);
                staker.deposit(amount, account);
                assertEq(rewardToken.balanceOf(account), prevRewardTokenBalance);
                uint256 newClaimableRewards = staker.totalSupply() > 0
                    ? (staker.balanceOf(account) * rewardAmount) / staker.totalSupply()
                    : 0;

                assertApproxEqAbs(
                    staker.claimableRewards(account, rewardToken) + prevRewardTokenBalance,
                    newClaimableRewards + pendingRewards[randomIndex],
                    10**(decimalReward - 4)
                );
            } else {
                amount = bound(amounts[i], 1, 10**9);
                staker.withdraw((amount * staker.balanceOf(account)) / 10**9, account, account);
                // there could be some pending rewards left because of rounding errors, see `testMultiWithdrawRewardsSuccess`
                uint256 estimatedNewClaimableRewards = staker.totalSupply() > 0
                    ? (staker.balanceOf(account) * rewardAmount) / staker.totalSupply()
                    : 0;
                assertApproxEqAbs(
                    staker.claimableRewards(account, rewardToken),
                    estimatedNewClaimableRewards,
                    10**(decimalReward - 4)
                );
            }

            vm.stopPrank();

            assertApproxEqAbs(
                rewardToken.balanceOf(account) + staker.pendingRewardsOf(rewardToken, account),
                pendingRewards[randomIndex],
                10**(decimalReward - 4)
            );
        }
    }

    // ================================ CLAIMREWARDS ===============================

    function testClaimRewardsSuccess(
        uint256[claimRewardsLengthArray] memory amounts,
        bool[claimRewardsLengthArray] memory isDeposit,
        uint256[claimRewardsLengthArray] memory accounts
    ) public {
        deal(address(rewardToken), address(staker), rewardAmount * (amounts.length));

        amounts[0] = bound(amounts[0], 1, maxTokenAmount);
        deal(address(asset), _alice, amounts[0]);
        vm.startPrank(_alice);
        asset.approve(address(staker), amounts[0]);
        staker.deposit(amounts[0], _alice);
        vm.stopPrank();

        uint256[4] memory pendingRewards;

        for (uint256 i = 1; i < amounts.length; i++) {
            staker.setRewardAmount(rewardAmount);
            uint256 randomIndex = bound(accounts[i], 0, 3);
            address account = randomIndex == 0 ? _alice : randomIndex == 1 ? _bob : randomIndex == 2
                ? _charlie
                : _dylan;
            if (staker.balanceOf(account) == 0) isDeposit[i] = true;

            {
                uint256 totSupply = staker.totalSupply();
                if (totSupply > 0) {
                    pendingRewards[0] += (staker.balanceOf(_alice) * rewardAmount) / staker.totalSupply();
                    pendingRewards[1] += (staker.balanceOf(_bob) * rewardAmount) / staker.totalSupply();
                    pendingRewards[2] += (staker.balanceOf(_charlie) * rewardAmount) / staker.totalSupply();
                    pendingRewards[3] += (staker.balanceOf(_dylan) * rewardAmount) / staker.totalSupply();
                }
            }

            uint256 amount;
            vm.startPrank(account);
            if (isDeposit[i]) {
                amount = bound(amounts[i], 1, maxTokenAmount);
                deal(address(asset), account, amount);
                uint256 prevRewardTokenBalance = rewardToken.balanceOf(account);
                asset.approve(address(staker), amount);
                staker.deposit(amount, account);

                // to disable new rewards when calling `claimableRewards` and `claimRewards`
                staker.setRewardAmount(0);
                uint256 functionClaimableRewards = staker.claimableRewards(account, rewardToken);
                uint256[] memory claimedRewards = staker.claimRewards(account);
                for (uint256 j = 0; i < claimedRewards.length; i++) {
                    console.log(j, claimedRewards[j]);
                }
                assertEq(functionClaimableRewards, claimedRewards[0]);
                assertEq(rewardToken.balanceOf(account) - prevRewardTokenBalance, functionClaimableRewards);
            } else {
                amount = bound(amounts[i], 1, 10**9);
                staker.withdraw((amount * staker.balanceOf(account)) / 10**9, account, account);

                // to disable new rewards when calling `claimableRewards` and `claimRewards`
                staker.setRewardAmount(0);
                uint256 prevRewardTokenBalance = rewardToken.balanceOf(account);
                uint256 functionClaimableRewards = staker.claimableRewards(account, rewardToken);
                uint256[] memory claimedRewards = staker.claimRewards(account);
                assertEq(functionClaimableRewards, claimedRewards[0]);
                assertEq(rewardToken.balanceOf(account) - prevRewardTokenBalance, functionClaimableRewards);
            }

            vm.stopPrank();

            assertApproxEqAbs(
                rewardToken.balanceOf(account) + staker.pendingRewardsOf(rewardToken, account),
                pendingRewards[randomIndex],
                10**(decimalReward - 4)
            );
        }
    }

    // ============================== CHANGEALLOWANCE ==============================

    function testChangeAllowanceWrongCaller() public {
        IERC20[] memory tokens = new IERC20[](0);
        address[] memory spenders = new address[](0);
        uint256[] memory amounts = new uint256[](0);

        vm.expectRevert(BorrowStakerStorage.NotGovernor.selector);
        vm.prank(_alice);
        staker.changeAllowance(tokens, spenders, amounts);
    }

    function testChangeAllowanceWrongLength() public {
        IERC20[] memory tokens = new IERC20[](0);
        address[] memory spenders = new address[](0);
        uint256[] memory amounts = new uint256[](0);

        vm.expectRevert(MockBorrowStaker.IncompatibleLengths.selector);
        vm.prank(_GOVERNOR);
        staker.changeAllowance(tokens, spenders, amounts);

        tokens = new IERC20[](1);
        spenders = new address[](1);
        amounts = new uint256[](0);

        vm.expectRevert(MockBorrowStaker.IncompatibleLengths.selector);
        vm.prank(_GOVERNOR);
        staker.changeAllowance(tokens, spenders, amounts);

        tokens = new IERC20[](0);
        spenders = new address[](1);
        amounts = new uint256[](1);

        vm.expectRevert(MockBorrowStaker.IncompatibleLengths.selector);
        vm.prank(_GOVERNOR);
        staker.changeAllowance(tokens, spenders, amounts);
    }

    function testChangeAllowance(uint256 amount) public {
        startHoax(_GOVERNOR);

        IERC20[] memory tokens = new IERC20[](1);
        address[] memory spenders = new address[](1);
        uint256[] memory amounts = new uint256[](1);

        // decrease allowance
        tokens[0] = asset;
        spenders[0] = address(_alice);
        amounts[0] = amount;
        staker.changeAllowance(tokens, spenders, amounts);

        assertEq(asset.allowance(address(staker), address(_alice)), amount);

        // keep same allowance
        tokens[0] = asset;
        spenders[0] = address(_alice);
        amounts[0] = amount;
        staker.changeAllowance(tokens, spenders, amounts);

        assertEq(asset.allowance(address(staker), address(_alice)), amount);

        // increase allowance
        tokens[0] = asset;
        spenders[0] = address(_alice);
        amounts[0] = type(uint256).max;
        staker.changeAllowance(tokens, spenders, amounts);

        assertEq(asset.allowance(address(staker), address(_alice)), type(uint256).max);
    }

    function testChangeAllowanceMulti(uint256 amount, uint256 amount2) public {
        startHoax(_GOVERNOR);
        IERC20[] memory tokens = new IERC20[](2);
        address[] memory spenders = new address[](2);
        uint256[] memory amounts = new uint256[](2);

        tokens[0] = asset;
        spenders[0] = address(_alice);
        amounts[0] = amount;
        tokens[1] = asset;
        spenders[1] = address(_bob);
        amounts[1] = amount2;

        staker.changeAllowance(tokens, spenders, amounts);

        assertEq(asset.allowance(address(staker), address(_alice)), amount);
        assertEq(asset.allowance(address(staker), address(_bob)), amount2);
    }
}
