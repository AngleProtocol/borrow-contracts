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

    uint256 public constant DEPOSIT_LENGTH = 10;
    uint256 public constant WITHDRAW_LENGTH = 10;
    uint256 public constant CLAIMABLE_LENGTH = 50;
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
        assertEq(staker.decimals(), decimalToken);
    }

    // =============================== ACCESS CONTROL ==============================

    function testStakerAccessControlInvalid(
        address randomUser,
        uint256 amount,
        address newCoreBorrow
    ) public {
        vm.assume(
            randomUser != _GOVERNOR &&
                randomUser != address(0) &&
                randomUser != address(proxyAdmin) &&
                newCoreBorrow != address(0)
        );
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

        // increase allowance
        tokens[0] = asset;
        spenders[0] = address(_alice);
        amounts[0] = type(uint256).max;
        staker.changeAllowance(tokens, spenders, amounts);

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

    // ============================== ADDVAULTMANAGER ==============================

    function testAddVaultManagersWrongCaller() public {
        startHoax(_alice);

        address _treasury = address(uint160(uint256(keccak256(abi.encodePacked("treasury")))));

        MockVaultManager vaultManager1 = new MockVaultManagerListing(_treasury);
        vaultManager1.setParams(_GOVERNOR, address(asset), address(otherToken), 1 ether, 0, BASE_STAKER / 2, 0);

        vm.expectRevert(BorrowStakerStorage.NotGovernorOrGuardian.selector);
        staker.addVaultManager(IVaultManagerListing(address(vaultManager1)));
    }

    function testAddVaultManagers() public {
        startHoax(_GUARDIAN);

        address _treasury = address(uint160(uint256(keccak256(abi.encodePacked("treasury")))));

        MockVaultManager vaultManager1 = new MockVaultManagerListing(_treasury);
        MockVaultManager vaultManager2 = new MockVaultManagerListing(_treasury);
        MockVaultManager vaultManagerWrong = new MockVaultManagerListing(_treasury);

        vaultManager1.setParams(_GOVERNOR, address(asset), address(otherToken), 1 ether, 0, BASE_STAKER / 2, 0);
        vaultManager2.setParams(_GOVERNOR, address(asset), address(rewardToken), 1 ether, 0, BASE_STAKER / 4, 0);
        vaultManagerWrong.setParams(
            _GOVERNOR,
            address(rewardToken),
            address(otherToken),
            1 ether,
            0,
            BASE_STAKER / 2,
            0
        );

        staker.addVaultManager(IVaultManagerListing(address(vaultManager1)));

        IVaultManagerListing[] memory vaultManagerList = staker.getVaultManagers();
        assertEq(vaultManagerList.length, 1);
        assertEq(address(vaultManagerList[0]), address(vaultManager1));

        vm.expectRevert(BorrowStakerStorage.InvalidVaultManager.selector);
        staker.addVaultManager(IVaultManagerListing(address(vaultManagerWrong)));

        vm.expectRevert(BorrowStakerStorage.InvalidVaultManager.selector);
        staker.addVaultManager(IVaultManagerListing(address(vaultManager1)));

        staker.addVaultManager(IVaultManagerListing(address(vaultManager2)));
        vaultManagerList = staker.getVaultManagers();
        assertEq(vaultManagerList.length, 2);
        assertEq(address(vaultManagerList[0]), address(vaultManager1));
        assertEq(address(vaultManagerList[1]), address(vaultManager2));

        vm.expectRevert(BorrowStakerStorage.InvalidVaultManager.selector);
        staker.addVaultManager(IVaultManagerListing(address(vaultManager2)));
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
    function testMultiDepositsSuccess(
        uint256[10] memory amounts,
        uint256[10] memory accounts,
        uint64[10] memory elapseTime
    ) public {
        amounts[0] = bound(amounts[0], 1, maxTokenAmount);
        deal(address(asset), _alice, amounts[0]);
        vm.startPrank(_alice);
        asset.approve(address(staker), amounts[0]);
        staker.deposit(amounts[0], _alice);
        vm.stopPrank();
        // advance in time for rewards to be taken into account
        elapseTime[0] = uint64(bound(elapseTime[0], 1, 86400 * 7));
        vm.warp(block.timestamp + elapseTime[0]);

        uint256 totalSupply = amounts[0];
        uint256[4] memory balanceOf;
        uint256 integral;
        uint256[4] memory integralOf;
        uint256[4] memory pendingRewards;
        balanceOf[0] = amounts[0];

        for (uint256 i = 1; i < amounts.length; i++) {
            elapseTime[i] = uint64(bound(elapseTime[i], 1, 86400 * 7));
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

            integral += (rewardAmount * BASE_STAKER) / totalSupply;
            uint256 newClaimable = (balanceOf[randomIndex] * (integral - integralOf[randomIndex])) / BASE_STAKER;
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

            // advance in time for rewards to be taken into account
            vm.warp(block.timestamp + elapseTime[i]);
        }
    }

    function testMultiDepositsRewardsSuccess(
        uint256[DEPOSIT_LENGTH] memory amounts,
        uint256[DEPOSIT_LENGTH] memory accounts,
        uint64[DEPOSIT_LENGTH] memory elapseTime
    ) public {
        amounts[0] = bound(amounts[0], 1, maxTokenAmount);
        deal(address(asset), _alice, amounts[0]);
        vm.startPrank(_alice);
        asset.approve(address(staker), amounts[0]);
        staker.deposit(amounts[0], _alice);
        vm.stopPrank();
        // advance in time for rewards to be taken into account
        elapseTime[0] = uint64(bound(elapseTime[0], 1, 86400 * 7));
        vm.warp(block.timestamp + elapseTime[0]);

        uint256[4] memory pendingRewards;

        for (uint256 i = 1; i < amounts.length; i++) {
            elapseTime[i] = uint64(bound(elapseTime[i], 1, 86400 * 7));

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

            vm.warp(block.timestamp + elapseTime[i]);
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
    function testFirstWithdrawSuccess(
        uint256 amount,
        address to,
        uint64 elapseTime
    ) public {
        vm.assume(to != address(0) && to != address(staker) && to != address(_alice) && to != address(asset));
        amount = bound(amount, 0, maxTokenAmount);
        deal(address(asset), address(_alice), amount);
        deal(address(rewardToken), address(staker), rewardAmount);

        startHoax(_alice);
        asset.approve(address(staker), amount);
        staker.deposit(amount, _alice);
        // advance in time for rewards to be taken into account
        elapseTime = uint64(bound(elapseTime, 1, 86400 * 7));
        vm.warp(block.timestamp + elapseTime);
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

    function testFirstWithdrawFullAllowanceSuccess(
        uint256 amount,
        address to,
        uint64 elapseTime
    ) public {
        vm.assume(to != address(0) && to != _alice && to != address(staker));
        amount = bound(amount, 1, maxTokenAmount);
        deal(address(asset), address(_alice), amount);
        deal(address(rewardToken), address(staker), rewardAmount);

        vm.startPrank(_alice);
        asset.approve(address(staker), amount);
        staker.deposit(amount, _alice);
        staker.approve(to, type(uint256).max);
        vm.stopPrank();
        // advance in time for rewards to be taken into account
        elapseTime = uint64(bound(elapseTime, 1, 86400 * 7));
        vm.warp(block.timestamp + elapseTime);
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
        address to,
        uint64 elapseTime
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
        // advance in time for rewards to be taken into account
        elapseTime = uint64(bound(elapseTime, 1, 86400 * 7));
        vm.warp(block.timestamp + elapseTime);
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
        uint256[WITHDRAW_LENGTH] memory amounts,
        bool[WITHDRAW_LENGTH] memory isDeposit,
        uint256[WITHDRAW_LENGTH] memory accounts,
        uint64[WITHDRAW_LENGTH] memory elapseTime
    ) public {
        deal(address(rewardToken), address(staker), rewardAmount * (amounts.length));

        amounts[0] = bound(amounts[0], 1, maxTokenAmount);
        deal(address(asset), _alice, amounts[0]);
        vm.startPrank(_alice);
        asset.approve(address(staker), amounts[0]);
        staker.deposit(amounts[0], _alice);
        vm.stopPrank();
        // advance in time for rewards to be taken into account
        elapseTime[0] = uint64(bound(elapseTime[0], 1, 86400 * 7));
        vm.warp(block.timestamp + elapseTime[0]);

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

            // advance in time for rewards to be taken into account
            elapseTime[i] = uint64(bound(elapseTime[i], 1, 86400 * 7));
            vm.warp(block.timestamp + elapseTime[i]);
        }
    }

    // ============================== CLAIMABLEREWARDS =============================

    function testClaimableRewardsSuccess(
        uint256[CLAIMABLE_LENGTH] memory amounts,
        bool[CLAIMABLE_LENGTH] memory isDeposit,
        uint256[CLAIMABLE_LENGTH] memory accounts,
        uint64[CLAIMABLE_LENGTH] memory elapseTime
    ) public {
        deal(address(rewardToken), address(staker), rewardAmount * (amounts.length));

        amounts[0] = bound(amounts[0], 1, maxTokenAmount);
        deal(address(asset), _alice, amounts[0]);
        vm.startPrank(_alice);
        asset.approve(address(staker), amounts[0]);
        staker.deposit(amounts[0], _alice);
        vm.stopPrank();
        // advance in time for rewards to be taken into account
        elapseTime[0] = uint64(bound(elapseTime[0], 1, 86400 * 7));
        vm.warp(block.timestamp + elapseTime[0]);

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

            // advance in time for rewards to be taken into account
            elapseTime[i] = uint64(bound(elapseTime[i], 1, 86400 * 7));
            vm.warp(block.timestamp + elapseTime[i]);
        }
    }

    // ================================= CHECKPOINT ================================

    function testCheckpointRewardsSuccess(
        uint256[CLAIM_LENGTH] memory amounts,
        bool[CLAIM_LENGTH] memory isDeposit,
        uint256[CLAIM_LENGTH] memory accounts,
        uint64[CLAIM_LENGTH] memory elapseTime
    ) public {
        deal(address(rewardToken), address(staker), rewardAmount * (amounts.length));

        amounts[0] = bound(amounts[0], 1, maxTokenAmount);
        deal(address(asset), _alice, amounts[0]);
        vm.startPrank(_alice);
        asset.approve(address(staker), amounts[0]);
        staker.deposit(amounts[0], _alice);
        vm.stopPrank();
        // advance in time for rewards to be taken into account
        elapseTime[0] = uint64(bound(elapseTime[0], 1, 86400 * 7));
        vm.warp(block.timestamp + elapseTime[0]);

        uint256[4] memory pendingRewards;

        for (uint256 i = 1; i < amounts.length; i++) {
            elapseTime[i] = uint64(bound(elapseTime[i], 1, 86400 * 7));
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
                asset.approve(address(staker), amount);
                staker.deposit(amount, account);

                // advance in time for rewards to be taken into account
                vm.warp(block.timestamp + elapseTime[i]);
                // to disable new rewards when calling `claimableRewards` and `claimRewards`
                staker.setRewardAmount(0);
                uint256 functionClaimableRewards = staker.claimableRewards(account, rewardToken);
                staker.checkpoint(account);
                assertEq(functionClaimableRewards, staker.pendingRewardsOf(rewardToken, account));
            } else {
                amount = bound(amounts[i], 1, 10**9);
                staker.withdraw((amount * staker.balanceOf(account)) / 10**9, account, account);

                // advance in time for rewards to be taken into account
                vm.warp(block.timestamp + elapseTime[i]);
                // to disable new rewards when calling `claimableRewards` and `claimRewards`
                staker.setRewardAmount(0);
                uint256 functionClaimableRewards = staker.claimableRewards(account, rewardToken);
                staker.checkpoint(account);
                assertEq(functionClaimableRewards, staker.pendingRewardsOf(rewardToken, account));
            }

            vm.stopPrank();

            assertApproxEqAbs(
                rewardToken.balanceOf(account) + staker.pendingRewardsOf(rewardToken, account),
                pendingRewards[randomIndex],
                10**(decimalReward - 4)
            );

            // advance in time for rewards to be taken into account
            vm.warp(block.timestamp + elapseTime[i]);
        }
    }

    // ================================ CLAIMREWARDS ===============================

    function testClaimRewardsSuccess(
        uint256[CLAIM_LENGTH] memory amounts,
        bool[CLAIM_LENGTH] memory isDeposit,
        uint256[CLAIM_LENGTH] memory accounts,
        uint64[CLAIM_LENGTH] memory elapseTime
    ) public {
        deal(address(rewardToken), address(staker), rewardAmount * (amounts.length));

        amounts[0] = bound(amounts[0], 1, maxTokenAmount);
        deal(address(asset), _alice, amounts[0]);
        vm.startPrank(_alice);
        asset.approve(address(staker), amounts[0]);
        staker.deposit(amounts[0], _alice);
        vm.stopPrank();
        // advance in time for rewards to be taken into account
        elapseTime[0] = uint64(bound(elapseTime[0], 1, 86400 * 7));
        vm.warp(block.timestamp + elapseTime[0]);

        uint256[4] memory pendingRewards;

        for (uint256 i = 1; i < amounts.length; i++) {
            elapseTime[i] = uint64(bound(elapseTime[i], 1, 86400 * 7));
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

                // advance in time for rewards to be taken into account
                vm.warp(block.timestamp + elapseTime[i]);
                // to disable new rewards when calling `claimableRewards` and `claimRewards`
                staker.setRewardAmount(0);
                uint256 functionClaimableRewards = staker.claimableRewards(account, rewardToken);
                uint256[] memory claimedRewards = staker.claimRewards(account);
                assertEq(functionClaimableRewards, claimedRewards[0]);
                assertEq(rewardToken.balanceOf(account) - prevRewardTokenBalance, functionClaimableRewards);
            } else {
                amount = bound(amounts[i], 1, 10**9);
                staker.withdraw((amount * staker.balanceOf(account)) / 10**9, account, account);

                // advance in time for rewards to be taken into account
                vm.warp(block.timestamp + elapseTime[i]);
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

            // advance in time for rewards to be taken into account
            vm.warp(block.timestamp + elapseTime[i]);
        }
    }

    function testClaimWithoutNewRewards(
        uint256[CLAIM_LENGTH] memory amounts,
        bool[CLAIM_LENGTH] memory isDeposit,
        uint256[CLAIM_LENGTH] memory accounts,
        uint64[CLAIM_LENGTH] memory elapseTime
    ) public {
        deal(address(rewardToken), address(staker), rewardAmount * (amounts.length));

        amounts[0] = bound(amounts[0], 1, maxTokenAmount);
        deal(address(asset), _alice, amounts[0]);
        vm.startPrank(_alice);
        asset.approve(address(staker), amounts[0]);
        staker.deposit(amounts[0], _alice);
        vm.stopPrank();
        // advance in time for rewards to be taken into account
        elapseTime[0] = uint64(bound(elapseTime[0], 1, 86400 * 7));
        vm.warp(block.timestamp + elapseTime[0]);

        uint256[4] memory pendingRewards;

        for (uint256 i = 1; i < amounts.length; i++) {
            elapseTime[i] = uint64(bound(elapseTime[i], 1, 86400 * 7));
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

                // advance in time for rewards to be taken into account
                vm.warp(block.timestamp + elapseTime[i]);
                // to disable new rewards when calling `claimableRewards` and `claimRewards`
                staker.setRewardAmount(0);
                uint256 functionClaimableRewards = staker.claimableRewards(account, rewardToken);
                uint256[] memory claimedRewards = staker.claimRewards(account);
                assertEq(functionClaimableRewards, claimedRewards[0]);
                assertEq(rewardToken.balanceOf(account) - prevRewardTokenBalance, functionClaimableRewards);
                // double claim without new rewards
                // advance in time for rewards to be taken into account
                vm.warp(block.timestamp + elapseTime[i]);
                staker.claimRewards(account);
                assertEq(rewardToken.balanceOf(account) - prevRewardTokenBalance, functionClaimableRewards);
            } else {
                amount = bound(amounts[i], 1, 10**9);
                staker.withdraw((amount * staker.balanceOf(account)) / 10**9, account, account);

                // advance in time for rewards to be taken into account
                vm.warp(block.timestamp + elapseTime[i]);
                // to disable new rewards when calling `claimableRewards` and `claimRewards`
                staker.setRewardAmount(0);
                uint256 prevRewardTokenBalance = rewardToken.balanceOf(account);
                uint256 functionClaimableRewards = staker.claimableRewards(account, rewardToken);
                uint256[] memory claimedRewards = staker.claimRewards(account);
                assertEq(functionClaimableRewards, claimedRewards[0]);
                assertEq(rewardToken.balanceOf(account) - prevRewardTokenBalance, functionClaimableRewards);

                // advance in time for rewards to be taken into account
                vm.warp(block.timestamp + elapseTime[i]);
                // double claim without new rewards
                staker.claimRewards(account);
                assertEq(rewardToken.balanceOf(account) - prevRewardTokenBalance, functionClaimableRewards);
            }

            vm.stopPrank();

            assertApproxEqAbs(
                rewardToken.balanceOf(account) + staker.pendingRewardsOf(rewardToken, account),
                pendingRewards[randomIndex],
                10**(decimalReward - 4)
            );

            // advance in time for rewards to be taken into account
            vm.warp(block.timestamp + elapseTime[i]);
        }
    }
}
