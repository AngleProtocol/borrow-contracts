// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import { stdStorage, StdStorage } from "forge-std/Test.sol";
import "../BaseTest.test.sol";
import { VaultManagerListing } from "../../../contracts/vaultManager/VaultManagerListing.sol";
import { ActionType } from "../../../contracts/interfaces/IVaultManager.sol";
import "../../../contracts/treasury/Treasury.sol";
import { MockBorrowStaker, MockBorrowStakerReset, BorrowStakerStorage } from "../../../contracts/mock/MockBorrowStaker.sol";
import "../../../contracts/mock/MockStableMaster.sol";
import "../../../contracts/mock/MockOracle.sol";
import "../../../contracts/mock/MockTokenPermit.sol";
import "../../../contracts/coreBorrow/CoreBorrow.sol";
import { AgToken } from "../../../contracts/agToken/AgToken.sol";
import "../../../contracts/ui-helpers/AngleHelpers.sol";

/// @notice Data stored to track someone's loan (or equivalently called position)
struct VaultList {
    uint256[] _aliceList;
    uint256[] _bobList;
    uint256[] _charlieList;
    uint256[] _dylanList;
}

contract VaultManagerListingTest is BaseTest {
    using stdStorage for StdStorage;

    address internal _hacker = address(uint160(uint256(keccak256(abi.encodePacked("hacker")))));

    MockStableMaster internal _contractStableMaster;
    VaultManagerListing internal _contractVaultManager;
    CoreBorrow internal _contractCoreBorrow;
    Treasury internal _contractTreasury;
    AgToken internal _contractAgToken;
    MockBorrowStakerReset public stakerImplementation;
    MockBorrowStakerReset public staker;
    AngleBorrowHelpers public helperImplementation;
    AngleBorrowHelpers public helper;
    MockTokenPermit public rewardToken;

    MockTokenPermit internal _collateral;
    MockOracle internal _oracle;

    // need to be reset at the beginning of every test
    mapping(address => uint256[]) public ownerListVaults;

    uint256 public constant ORACLE_VALUE = 5 ether;
    uint64 public constant CF = 0.8e9;
    uint8 public decimalToken = 18;
    uint8 public decimalReward = 6;
    uint256 public maxTokenAmount = 10**15 * 10**decimalToken;
    uint256 public rewardAmount = 10**2 * 10**(decimalReward);
    uint256 public constant TRANSFER_LENGTH = 5;

    function setUp() public override {
        super.setUp();

        delete ownerListVaults[_alice];
        delete ownerListVaults[_bob];
        delete ownerListVaults[_charlie];
        delete ownerListVaults[_dylan];

        _contractStableMaster = new MockStableMaster();

        _contractAgToken = new AgToken();
        vm.store(address(_contractAgToken), bytes32(uint256(0)), bytes32(uint256(0)));
        _contractAgToken.initialize("agEUR", "agEUR", address(_contractStableMaster));

        _contractCoreBorrow = new CoreBorrow();
        vm.store(address(_contractCoreBorrow), bytes32(uint256(0)), bytes32(uint256(0)));
        _contractCoreBorrow.initialize(_GOVERNOR, _GUARDIAN);

        _contractTreasury = new Treasury();
        vm.store(address(_contractTreasury), bytes32(uint256(0)), bytes32(uint256(0)));
        _contractTreasury.initialize(_contractCoreBorrow, _contractAgToken);

        _oracle = new MockOracle(ORACLE_VALUE, _contractTreasury);

        _collateral = new MockTokenPermit("Name", "SYM", decimalToken);
        rewardToken = new MockTokenPermit("reward", "rwrd", decimalReward);

        stakerImplementation = new MockBorrowStakerReset();
        staker = MockBorrowStakerReset(
            deployUpgradeable(
                address(stakerImplementation),
                abi.encodeWithSelector(staker.initialize.selector, coreBorrow, _collateral)
            )
        );

        _contractVaultManager = new VaultManagerListing(0, 0);
        vm.store(address(_contractVaultManager), bytes32(uint256(0)), bytes32(uint256(0)));

        // No protocol revenue for easier computation
        VaultParameters memory params = VaultParameters({
            debtCeiling: type(uint256).max / 10**27,
            collateralFactor: CF,
            targetHealthFactor: 1.1e9,
            interestRate: 1.547e18,
            liquidationSurcharge: 1e9,
            maxLiquidationDiscount: 0.1e9,
            whitelistingActivated: false,
            baseBoost: 1e9
        });
        _contractVaultManager.initialize(_contractTreasury, IERC20(address(staker)), _oracle, params, "wETH");

        vm.prank(_GOVERNOR);
        _contractAgToken.setUpTreasury(address(_contractTreasury));

        helperImplementation = new AngleBorrowHelpers();
        helper = new AngleBorrowHelpers();

        vm.startPrank(_GOVERNOR);
        _contractVaultManager.togglePause();
        _contractTreasury.addVaultManager(address(_contractVaultManager));
        vm.stopPrank();

        vm.prank(address(_contractTreasury));
        _contractAgToken.addMinter(_GOVERNOR);
    }

    function testVaultListAndCollateralAmounts(
        uint256[TRANSFER_LENGTH] memory accounts,
        uint256[TRANSFER_LENGTH] memory tos,
        uint256[TRANSFER_LENGTH] memory actionTypes,
        uint256[TRANSFER_LENGTH] memory amounts
    ) public {
        uint256[5] memory collateralVaultAmounts;
        uint256[5] memory collateralIdleAmounts;

        amounts[0] = bound(amounts[0], 1, maxTokenAmount);
        _openVault(_alice, _alice, amounts[0]);
        collateralVaultAmounts[0] += amounts[0];
        ownerListVaults[_alice].push(_contractVaultManager.vaultIDCount());

        for (uint256 i = 1; i < amounts.length; i++) {
            (uint256 randomIndex, address account) = _getAccountByIndex(accounts[i]);
            uint256 action = bound(actionTypes[i], 0, 6);
            if (ownerListVaults[account].length == 0) action = 0;

            if (action == 0) {
                uint256 amount = bound(amounts[i], 1, maxTokenAmount);
                (uint256 randomIndexTo, address to) = _getAccountByIndex(tos[i]);
                _openVault(account, to, amount);
                collateralVaultAmounts[randomIndexTo] += amount;
                ownerListVaults[to].push(_contractVaultManager.vaultIDCount());
            } else if (action == 1) {
                uint256[] storage vaultIDs = ownerListVaults[account];
                amounts[i] = bound(amounts[i], 0, vaultIDs.length - 1);
                uint256 vaultID = vaultIDs[amounts[i]];
                uint256 collateralAmount = _closeVault(account, vaultID);
                collateralVaultAmounts[randomIndex] -= collateralAmount;
                collateralIdleAmounts[randomIndex] += collateralAmount;
                _removeVaultFromList(vaultIDs, vaultID);
            } else if (action == 2) {
                uint256[] storage vaultIDs = ownerListVaults[account];
                (uint256 randomIndexTo, address to) = _getAccountByIndex(tos[i]);
                amounts[i] = bound(amounts[i], 0, vaultIDs.length - 1);
                uint256 vaultID = vaultIDs[amounts[i]];
                uint256 vaultDebt = _contractVaultManager.getVaultDebt(vaultID);
                (uint256 collateralAmount, ) = _contractVaultManager.vaultData(vaultID);
                collateralVaultAmounts[randomIndex] -= collateralAmount;
                collateralVaultAmounts[randomIndexTo] += collateralAmount;
                vm.startPrank(account);
                _contractVaultManager.transferFrom(account, to, vaultID);
                // so that if the other one close it he has enough
                // this doesn't work if the debt increased, we would need to increase
                // artificially the owner balance too
                _contractAgToken.transfer(to, vaultDebt);
                vm.stopPrank();
                _removeVaultFromList(vaultIDs, vaultID);
                uint256[] storage vaultToIDs = ownerListVaults[to];
                _addVaultFromList(vaultToIDs, vaultID);
            } else if (action == 3) {
                uint256[] storage vaultIDs = ownerListVaults[account];
                amounts[i] = bound(amounts[i], 1, maxTokenAmount);
                tos[i] = bound(tos[i], 0, vaultIDs.length - 1);
                uint256 vaultID = vaultIDs[tos[i]];
                _addToVault(account, vaultID, amounts[i]);
                collateralVaultAmounts[randomIndex] += amounts[i];
            } else if (action == 4) {
                uint256[] storage vaultIDs = ownerListVaults[account];
                tos[i] = bound(tos[i], 0, vaultIDs.length - 1);
                uint256 vaultID = vaultIDs[tos[i]];
                uint256 collateralAmount = _removeFromVault(account, vaultID, amounts[i]);
                collateralVaultAmounts[randomIndex] -= collateralAmount;
                collateralIdleAmounts[randomIndex] += collateralAmount;
            } else if (action == 5) {
                uint256[] storage vaultIDs = ownerListVaults[account];
                amounts[i] = bound(amounts[i], 0, vaultIDs.length - 1);
                uint256 vaultID = vaultIDs[amounts[i]];
                (bool liquidated, uint256 collateralAmount) = _liquidateVault(_hacker, vaultID);
                collateralVaultAmounts[randomIndex] -= collateralAmount;
                collateralIdleAmounts[4] += collateralAmount;
                if (liquidated) _removeVaultFromList(vaultIDs, vaultID);
            } else if (action == 6) {
                // partial liquidation
                uint256[] storage vaultIDs = ownerListVaults[account];
                amounts[i] = bound(amounts[i], 0, vaultIDs.length - 1);
                uint256 vaultID = vaultIDs[amounts[i]];
                (bool fullLiquidation, uint256 collateralAmount) = _partialLiquidationVault(_hacker, vaultID);
                collateralVaultAmounts[randomIndex] -= collateralAmount;
                collateralIdleAmounts[4] += collateralAmount;
                if (fullLiquidation) _removeVaultFromList(vaultIDs, vaultID);
            } else if (action == 7) {
                // just deposit into the staker
                amounts[i] = bound(amounts[i], 0, maxTokenAmount);
                (uint256 randomIndexTo, address to) = _getAccountByIndex(tos[i]);
                deal(address(_collateral), account, amounts[i]);
                vm.startPrank(account);
                // first get the true collateral
                _collateral.approve(address(staker), amounts[i]);
                staker.deposit(amounts[i], to);
                collateralIdleAmounts[randomIndexTo] += amounts[i];
                vm.stopPrank();
            } else if (action == 8) {
                // just withdraw into the staker
                amounts[i] = bound(amounts[i], 1, BASE_PARAMS);
                (, address to) = _getAccountByIndex(tos[i]);
                uint256 withdrawnDirectly = (amounts[i] * staker.balanceOf(account)) / BASE_PARAMS;
                staker.withdraw(withdrawnDirectly, account, to);
                collateralIdleAmounts[randomIndex] -= amounts[i];
                vm.stopPrank();
            }
            for (uint256 k = 0; k < 5; k++) {
                address checkedAccount = k == 0 ? _alice : k == 1 ? _bob : k == 2 ? _charlie : k == 3
                    ? _dylan
                    : _hacker;
                assertEq(
                    collateralVaultAmounts[k] + collateralIdleAmounts[k],
                    staker.balanceOf(checkedAccount) + _contractVaultManager.getUserCollateral(checkedAccount)
                );
                assertEq(collateralVaultAmounts[k], _contractVaultManager.getUserCollateral(checkedAccount));
                uint256[] memory vaultIDs = ownerListVaults[checkedAccount];
                (uint256[] memory helperVaultIDs, uint256 count) = helper.getControlledVaults(
                    IVaultManager(address(_contractVaultManager)),
                    checkedAccount
                );
                (helperVaultIDs, count) = _removeBurntVaultLists(_contractVaultManager, helperVaultIDs, count);
                _compareLists(vaultIDs, helperVaultIDs, count);
                if (checkedAccount == _hacker) assertEq(vaultIDs.length, 0);
            }
        }
    }

    // function testBorrowStakerWithVaultManager(
    //     uint256[TRANSFER_LENGTH] memory accounts,
    //     uint256[TRANSFER_LENGTH] memory tos,
    //     uint256[TRANSFER_LENGTH] memory actionTypes,
    //     uint256[TRANSFER_LENGTH] memory amounts
    // ) public {
    //     uint256[5] memory collateralAmounts;
    //     uint256[5] memory pendingRewards;

    //     amounts[0] = bound(amounts[0], 1, maxTokenAmount);
    //     _openVault(_alice, _alice, amounts[0]);
    //     collateralAmounts[0] += amounts[0];

    //     for (uint256 i = 1; i < amounts.length; i++) {
    //         (uint256 randomIndex, address account) = _getAccountByIndex(accounts[i]);
    //         uint256 action = bound(actionTypes[i], 0, 5);
    //         {
    //             (, uint256 count) = helper.getControlledVaults(IVaultManager(address(_contractVaultManager)), account);
    //             if (count == 0) action = 0;
    //         }

    //         {
    //             uint256 totSupply = staker.totalSupply();
    //             uint256 _rewardAmount = staker.rewardAmount();
    //             if (totSupply > 0) {
    //                 pendingRewards[0] += (collateralAmounts[0] * _rewardAmount) / totSupply;
    //                 pendingRewards[1] += (collateralAmounts[1] * _rewardAmount) / totSupply;
    //                 pendingRewards[2] += (collateralAmounts[2] * _rewardAmount) / totSupply;
    //                 pendingRewards[3] += (collateralAmounts[3] * _rewardAmount) / totSupply;
    //             }
    //         }

    //         if (action == 0) {
    //             uint256 amount = bound(amounts[i], 1, maxTokenAmount);
    //             (uint256 randomIndexTo, address to) = _getAccountByIndex(tos[i]);
    //             _openVault(account, to, amount);
    //             collateralAmounts[randomIndexTo] += amount;
    //         } else if (action == 1) {
    //             console.log("in the close");
    //             (uint256[] memory vaultIDs, uint256 count) = helper.getControlledVaults(
    //                 IVaultManager(address(_contractVaultManager)),
    //                 account
    //             );
    //             amounts[i] = bound(amounts[i], 0, count - 1);
    //             uint256 vaultID = vaultIDs[amounts[i]];
    //             _closeVault(account, vaultID);
    //         } else if (action == 2) {
    //             console.log("in the transfer");
    //             (uint256[] memory vaultIDs, uint256 count) = helper.getControlledVaults(
    //                 IVaultManager(address(_contractVaultManager)),
    //                 account
    //             );
    //             (uint256 randomIndexTo, address to) = _getAccountByIndex(tos[i]);
    //             amounts[i] = bound(amounts[i], 0, count - 1);
    //             uint256 vaultID = vaultIDs[amounts[i]];
    //             uint256 vaultDebt = _contractVaultManager.getVaultDebt(vaultID);
    //             (uint256 collateralAmount, ) = _contractVaultManager.vaultData(vaultID);
    //             vm.startPrank(account);
    //             _contractVaultManager.transferFrom(account, to, vaultID);
    //             // so that if the other one close it he has enough
    //             // this doesn't work if the debt increased, we would need to increase
    //             // artificially the owner balance too
    //             _contractAgToken.transfer(to, vaultDebt);
    //             collateralAmounts[randomIndex] -= collateralAmount;
    //             collateralAmounts[randomIndexTo] += collateralAmount;
    //             vm.stopPrank();
    //         } else if (action == 3) {
    //             console.log("in the add");
    //             (uint256[] memory vaultIDs, uint256 count) = helper.getControlledVaults(
    //                 IVaultManager(address(_contractVaultManager)),
    //                 account
    //             );
    //             amounts[i] = bound(amounts[i], 1, maxTokenAmount);
    //             tos[i] = bound(tos[i], 0, count - 1);
    //             uint256 vaultID = vaultIDs[tos[i]];
    //             _addToVault(account, vaultID, amounts[i]);
    //             collateralAmounts[randomIndex] += amounts[i];
    //         } else if (action == 4) {
    //             console.log("in the remove");

    //             (uint256[] memory vaultIDs, uint256 count) = helper.getControlledVaults(
    //                 IVaultManager(address(_contractVaultManager)),
    //                 account
    //             );
    //             tos[i] = bound(tos[i], 0, count);
    //             uint256 vaultID = vaultIDs[tos[i]];
    //             _removeFromVault(account, vaultID, amounts[i]);
    //         } else if (action == 5) {
    //             console.log("in the liquidate");
    //             (uint256[] memory vaultIDs, uint256 count) = helper.getControlledVaults(
    //                 IVaultManager(address(_contractVaultManager)),
    //                 account
    //             );
    //             amounts[i] = bound(amounts[i], 0, count - 1);
    //             uint256 vaultID = vaultIDs[amounts[i]];
    //             (, uint256 collateralAmount) = _liquidateVault(_hacker, vaultID);
    //             collateralAmounts[randomIndex] -= collateralAmount;
    //             collateralAmounts[4] += collateralAmount;
    //         } else if (action == 6) {
    //             console.log("in the partial liquidate");
    //             // partial liquidation
    //             (uint256[] memory vaultIDs, uint256 count) = helper.getControlledVaults(
    //                 IVaultManager(address(_contractVaultManager)),
    //                 account
    //             );
    //             amounts[i] = bound(amounts[i], 0, count - 1);
    //             uint256 vaultID = vaultIDs[amounts[i]];
    //             (, uint256 collateralAmount) = _partialLiquidationVault(_hacker, vaultID);
    //             collateralAmounts[randomIndex] -= collateralAmount;
    //             collateralAmounts[4] += collateralAmount;
    //         } else if (action == 7) {
    //             // just deposit into the staker
    //             amounts[i] = bound(amounts[i], 0, maxTokenAmount);
    //             (uint256 randomIndexTo, address to) = _getAccountByIndex(tos[i]);
    //             deal(address(_collateral), account, amounts[i]);
    //             vm.startPrank(account);
    //             // first get the true collateral
    //             _collateral.approve(address(staker), amounts[i]);
    //             staker.deposit(amounts[i], to);
    //             collateralAmounts[randomIndexTo] += amounts[i];
    //             vm.stopPrank();
    //         } else if (action == 8) {
    //             // just withdraw into the staker
    //             amounts[i] = bound(amounts[i], 1, BASE_PARAMS);
    //             (, address to) = _getAccountByIndex(tos[i]);
    //             uint256 withdrawnDirectly = (amounts[i] * staker.balanceOf(account)) / BASE_PARAMS;
    //             staker.withdraw(withdrawnDirectly, account, to);
    //             collateralAmounts[randomIndex] -= amounts[i];
    //             vm.stopPrank();
    //         } else if (action == 9) {
    //             // add a reward
    //             amounts[i] = bound(amounts[i], 0, 10_000_000 * 10**decimalReward);
    //             deal(address(rewardToken), address(staker), amounts[i]);
    //             staker.setRewardAmount(amounts[i]);
    //         }
    //         for (uint256 k = 0; k < 4; k++) {
    //             address checkedAccount = k == 0 ? _alice : k == 1 ? _bob : k == 2 ? _charlie : k == 3
    //                 ? _dylan
    //                 : _hacker;
    //             assertEq(
    //                 collateralAmounts[k],
    //                 staker.balanceOf(checkedAccount) + _contractVaultManager.getUserCollateral(checkedAccount)
    //             );
    //             assertApproxEqAbs(
    //                 rewardToken.balanceOf(checkedAccount) + staker.pendingRewardsOf(rewardToken, checkedAccount),
    //                 pendingRewards[k],
    //                 10**(decimalReward - 4)
    //             );
    //         }
    //     }
    // }

    // ============================= INTERNAL FUNCTIONS ============================

    function _getAccountByIndex(uint256 index) internal view returns (uint256, address) {
        uint256 randomIndex = bound(index, 0, 3);
        address account = randomIndex == 0 ? _alice : randomIndex == 1 ? _bob : randomIndex == 2 ? _charlie : _dylan;
        return (randomIndex, account);
    }

    function _openVault(
        address spender,
        address owner,
        uint256 amount
    ) internal {
        uint256 numberActions = 3;
        ActionType[] memory actions = new ActionType[](numberActions);
        actions[0] = ActionType.createVault;
        actions[1] = ActionType.addCollateral;
        actions[2] = ActionType.borrow;

        bytes[] memory datas = new bytes[](numberActions);
        datas[0] = abi.encode(owner);
        datas[1] = abi.encode(0, amount);
        // to be over the liquidation threshold
        datas[2] = abi.encode(0, (amount * ORACLE_VALUE) / 2 ether);

        // to allow to borrow for somebody else
        if (owner != spender) {
            vm.startPrank(owner);
            _contractVaultManager.setApprovalForAll(spender, true);
            vm.stopPrank();
        }

        deal(address(_collateral), spender, amount);
        vm.startPrank(spender);
        // first get the true collateral
        _collateral.approve(address(staker), amount);
        staker.deposit(amount, spender);
        // then open the vault
        staker.approve(address(_contractVaultManager), amount);
        _contractVaultManager.angle(actions, datas, spender, owner);
        vm.stopPrank();

        if (owner != spender) {
            vm.startPrank(owner);
            _contractVaultManager.setApprovalForAll(spender, false);
            vm.stopPrank();
        }
    }

    function _closeVault(address owner, uint256 vaultID) internal returns (uint256 collateralAmount) {
        (collateralAmount, ) = _contractVaultManager.vaultData(vaultID);

        uint256 numberActions = 1;
        ActionType[] memory actions = new ActionType[](numberActions);
        actions[0] = ActionType.closeVault;

        bytes[] memory datas = new bytes[](numberActions);
        datas[0] = abi.encode(vaultID);

        vm.startPrank(owner);
        _contractVaultManager.angle(actions, datas, owner, owner);
        vm.stopPrank();
    }

    function _addToVault(
        address owner,
        uint256 vaultID,
        uint256 amount
    ) internal {
        uint256 numberActions = 1;
        ActionType[] memory actions = new ActionType[](numberActions);
        actions[0] = ActionType.addCollateral;

        bytes[] memory datas = new bytes[](numberActions);
        datas[0] = abi.encode(vaultID, amount);

        deal(address(_collateral), owner, amount);
        vm.startPrank(owner);
        // first get the true collateral
        _collateral.approve(address(staker), amount);
        staker.deposit(amount, owner);
        // then open the vault
        staker.approve(address(_contractVaultManager), amount);
        _contractVaultManager.angle(actions, datas, owner, owner);
        vm.stopPrank();
    }

    function _removeFromVault(
        address owner,
        uint256 vaultID,
        uint256 amount
    ) internal returns (uint256 collateralAmount) {
        uint256 vaultDebt = _contractVaultManager.getVaultDebt(vaultID);
        (uint256 currentCollat, ) = _contractVaultManager.vaultData(vaultID);
        // Taking a buffer when withdrawing for rounding errors
        vaultDebt = (11 * ((((((vaultDebt * BASE_PARAMS) / CF + 1) * 10**decimalToken))) / ORACLE_VALUE + 1)) / 10;

        if (vaultDebt >= currentCollat || vaultDebt == 0) return 0;
        amount = bound(amount, 1, currentCollat - vaultDebt);

        uint256 numberActions = 1;
        ActionType[] memory actions = new ActionType[](numberActions);
        actions[0] = ActionType.removeCollateral;

        bytes[] memory datas = new bytes[](numberActions);
        datas[0] = abi.encode(vaultID, amount);

        vm.startPrank(owner);
        _contractVaultManager.angle(actions, datas, owner, owner);
        vm.stopPrank();
        return amount;
    }

    function _liquidateVault(address liquidator, uint256 vaultID) internal returns (bool, uint256) {
        // to be able to liquidate it fully
        uint256 vaultDebt = _contractVaultManager.getVaultDebt(vaultID);
        (uint256 currentCollat, ) = _contractVaultManager.vaultData(vaultID);
        if (currentCollat == 0) return (false, 0);
        {
            uint256 newOracleValue = (((vaultDebt * BASE_PARAMS) / CF) * 10**decimalToken) / currentCollat / 100;
            if (newOracleValue == 0) return (false, 0);
            _oracle.update(newOracleValue);
        }

        _internalLiquidateVault(liquidator, vaultID);
        _oracle.update(ORACLE_VALUE);
        return (true, currentCollat);
    }

    function _partialLiquidationVault(address liquidator, uint256 vaultID) internal returns (bool, uint256) {
        // to be able to liquidate it fully
        uint256 vaultDebt = _contractVaultManager.getVaultDebt(vaultID);
        (uint256 currentCollat, ) = _contractVaultManager.vaultData(vaultID);

        {
            uint256 newOracleValue = (((vaultDebt * BASE_PARAMS) / CF) * 10**decimalToken) / currentCollat;
            if (newOracleValue < 2) return (false, 0);
            else newOracleValue -= 1;
            _oracle.update(newOracleValue);
        }

        _internalLiquidateVault(liquidator, vaultID);
        _oracle.update(ORACLE_VALUE);
        (uint256 newCollat, ) = _contractVaultManager.vaultData(vaultID);
        return (newCollat == 0, currentCollat - newCollat);
    }

    function _internalLiquidateVault(address liquidator, uint256 vaultID) internal {
        LiquidationOpportunity memory liqOpp = _contractVaultManager.checkLiquidation(vaultID, liquidator);
        console.log("liqOpp ", liqOpp.thresholdRepayAmount);
        uint256 amountToReimburse = liqOpp.maxStablecoinAmountToRepay;

        uint256 numberActions = 1;
        uint256[] memory vaultIDs = new uint256[](numberActions);
        vaultIDs[0] = vaultID;
        uint256[] memory amounts = new uint256[](numberActions);
        amounts[0] = amountToReimburse;

        vm.prank(_GOVERNOR);
        _contractAgToken.mint(liquidator, amountToReimburse);

        vm.startPrank(liquidator);
        // can try with a to different than liquidator
        _contractVaultManager.liquidate(vaultIDs, amounts, liquidator, liquidator);
        vm.stopPrank();
    }

    /// @dev Not the most efficient way but to keep the vaultIDs ordered
    function _addVaultFromList(uint256[] storage vaultList, uint256 vaultID) internal {
        vaultList.push(vaultID);
        uint256 vaultListLength = vaultList.length;
        if (vaultListLength == 1) return;
        int256 i = int256(vaultListLength - 2);
        for (; i >= 0; i--) {
            if (vaultList[uint256(i)] > vaultID) vaultList[uint256(i) + 1] = vaultList[uint256(i)];
            else break;
        }
        vaultList[uint256(i + 1)] = vaultID;
    }

    /// @dev Not the most efficient way but to keep the vaultIDs ordered
    function _removeVaultFromList(uint256[] storage vaultList, uint256 vaultID) internal {
        uint256 vaultListLength = vaultList.length;
        bool indexMet;
        for (uint256 i = 0; i < vaultListLength; i++) {
            if (vaultList[i] == vaultID) indexMet = true;
            else if (indexMet) vaultList[i - 1] = vaultList[i];
        }
        vaultList.pop();
    }

    function _compareLists(
        uint256[] memory expectedVaultList,
        uint256[] memory vaultList,
        uint256 count
    ) internal {
        assertEq(count, expectedVaultList.length);
        for (uint256 i = 0; i < count; i++) {
            assertEq(vaultList[i], expectedVaultList[i]);
        }
    }

    function _removeBurntVaultLists(
        VaultManagerListing vaultManager,
        uint256[] memory vaultList,
        uint256 count
    ) internal view returns (uint256[] memory processList, uint256) {
        processList = new uint256[](vaultList.length);
        uint256 newCount;
        for (uint256 i = 0; i < count; i++) {
            (uint256 currentCollat, uint256 debt) = vaultManager.vaultData(vaultList[i]);
            if (currentCollat != 0 && debt != 0) {
                processList[newCount] = vaultList[i];
                newCount += 1;
            }
        }
        return (processList, newCount);
    }

    function _logArray(
        uint256[] memory list,
        uint256 count,
        address owner
    ) internal view {
        console.log("owner: ", owner);
        count = count == type(uint256).max ? list.length : count;
        for (uint256 i = 0; i < count; i++) {
            console.log("owns vaultID: ", list[i]);
        }
    }
}
