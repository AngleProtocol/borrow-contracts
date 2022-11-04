// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import { stdStorage, StdStorage } from "forge-std/Test.sol";
import "../BaseTest.test.sol";
import { VaultManagerListing } from "../../../contracts/vaultManager/VaultManagerListing.sol";
import { ActionType } from "../../../contracts/interfaces/IVaultManager.sol";
import "../../../contracts/treasury/Treasury.sol";
import { MockBorrowStaker, BorrowStakerStorage } from "../../../contracts/mock/MockBorrowStaker.sol";
import "../../../contracts/mock/MockStableMaster.sol";
import "../../../contracts/mock/MockOracle.sol";
import "../../../contracts/mock/MockTokenPermit.sol";
import "../../../contracts/coreBorrow/CoreBorrow.sol";
import "../../../contracts/agToken/AgToken.sol";

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
    MockBorrowStaker public stakerImplementation;
    MockBorrowStaker public staker;
    MockTokenPermit public rewardToken;

    MockTokenPermit internal _collateral;
    MockOracle internal _oracle;

    // need to be reset at the beginning of every test
    mapping(address => uint256[]) public ownerListVaults;

    uint256 public constant ORACLE_VALUE = 5 ether;
    uint8 public decimalToken = 18;
    uint8 public decimalReward = 6;
    uint256 public maxTokenAmount = 10**15 * 10**decimalToken;
    uint256 public rewardAmount = 10**2 * 10**(decimalReward);
    uint256 public constant TRANSFER_LENGTH = 50;

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

        stakerImplementation = new MockBorrowStaker();
        staker = MockBorrowStaker(
            deployUpgradeable(
                address(stakerImplementation),
                abi.encodeWithSelector(staker.initialize.selector, coreBorrow, _collateral)
            )
        );

        _contractVaultManager = new VaultManagerListing(0, 0);
        vm.store(address(_contractVaultManager), bytes32(uint256(0)), bytes32(uint256(0)));

        VaultParameters memory params = VaultParameters({
            debtCeiling: type(uint256).max / BASE_PARAMS,
            collateralFactor: 0.8e9,
            targetHealthFactor: 1.1e9,
            interestRate: 1.547e18,
            liquidationSurcharge: 0.9e9,
            maxLiquidationDiscount: 0.1e9,
            whitelistingActivated: false,
            baseBoost: 1e9
        });
        _contractVaultManager.initialize(_contractTreasury, IERC20(address(staker)), _oracle, params, "wETH");

        vm.prank(0xdC4e6DFe07EFCa50a197DF15D9200883eF4Eb1c8);
        _contractAgToken.setUpTreasury(address(_contractTreasury));

        vm.startPrank(_GOVERNOR);
        _contractVaultManager.togglePause();
        _contractTreasury.addVaultManager(address(_contractVaultManager));
        vm.stopPrank();
    }

    function testVaultListWhenTransfers(
        uint256[TRANSFER_LENGTH] memory accounts,
        uint256[TRANSFER_LENGTH] memory tos,
        uint256[TRANSFER_LENGTH] memory actionTypes,
        uint256[TRANSFER_LENGTH] memory amounts
    ) public {
        // uint256[TRANSFER_LENGTH][4] memory vaultLists;
        // for (uint256 i = 0; i < 4; i++) {
        //     vaultLists[i] = new uint256[]();
        // }

        amounts[0] = bound(amounts[0], 1, maxTokenAmount);
        _openVault(_alice, _alice, amounts[0]);
        ownerListVaults[_alice].push(_contractVaultManager.vaultIDCount());

        for (uint256 i = 1; i < amounts.length; i++) {
            (uint256 randomIndex, address account) = _getAccountByIndex(accounts[i]);
            uint256 action = bound(actionTypes[i], 0, 3);
            if (ownerListVaults[account].length == 0) action = 0;

            if (action == 0) {
                uint256 amount = bound(amounts[i], 1, maxTokenAmount);
                (, address to) = _getAccountByIndex(tos[i]);
                _openVault(account, to, amount);
                ownerListVaults[to].push(_contractVaultManager.vaultIDCount());
            } else if (action == 1) {
                uint256[] storage vaultIDs = ownerListVaults[account];
                amounts[i] = bound(amounts[i], 0, vaultIDs.length - 1);
                uint256 vaultID = vaultIDs[amounts[i]];
                _closeVault(account, vaultID);
                _removeVaultFromList(vaultIDs, vaultID);
            } else if (action == 2) {
                uint256[] storage vaultIDs = ownerListVaults[account];
                (, address to) = _getAccountByIndex(tos[i]);
                amounts[i] = bound(amounts[i], 0, vaultIDs.length - 1);
                uint256 vaultID = vaultIDs[amounts[i]];
                uint256 vaultDebt = _contractVaultManager.getVaultDebt(vaultID);
                vm.startPrank(account);
                _contractVaultManager.transferFrom(account, to, vaultID);
                // so that if the other one close it he has enough
                // this doesn't work if the debt increased, we would need to increase
                // artificially the owner balance too
                _contractAgToken.transfer(to, vaultDebt);
                vm.stopPrank();
                _removeVaultFromList(vaultIDs, vaultID);
                ownerListVaults[to].push(vaultID);
            } else if (action == 3) {
                uint256[] storage vaultIDs = ownerListVaults[account];
                amounts[i] = bound(amounts[i], 0, vaultIDs.length - 1);
                uint256 vaultID = vaultIDs[amounts[i]];
                _liquidateVault(_hacker, vaultID);
                _removeVaultFromList(vaultIDs, vaultID);
            }
            for (uint256 k = 0; k < 1; k++) {
                address checkedAccount = randomIndex == 0 ? _alice : randomIndex == 1 ? _bob : randomIndex == 2
                    ? _charlie
                    : randomIndex == 3
                    ? _dylan
                    : _hacker;
                uint256[] storage vaultIDs = ownerListVaults[checkedAccount];
                _logArray(vaultIDs, checkedAccount);
                _logArray(_contractVaultManager.getUserVaults(checkedAccount), checkedAccount);
                _compareLists(vaultIDs, _contractVaultManager.getUserVaults(checkedAccount));
                if (checkedAccount == _hacker) assertEq(vaultIDs.length, 0);
            }
        }
    }

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

    function _closeVault(address owner, uint256 vaultID) internal {
        uint256 numberActions = 1;
        ActionType[] memory actions = new ActionType[](numberActions);
        actions[0] = ActionType.closeVault;

        bytes[] memory datas = new bytes[](numberActions);
        datas[0] = abi.encode(vaultID);

        vm.startPrank(owner);
        _contractVaultManager.angle(actions, datas, owner, owner);
        vm.stopPrank();
    }

    function _liquidateVault(address liquidator, uint256 vaultID) internal {
        // to be able to liquidate it fully
        _oracle.update(ORACLE_VALUE / 1000);
        LiquidationOpportunity memory liqOpp = _contractVaultManager.checkLiquidation(vaultID, liquidator);
        uint256 numberActions = 1;
        uint256[] memory vaultIDs = new uint256[](numberActions);
        vaultIDs[0] = vaultID;
        uint256[] memory amounts = new uint256[](numberActions);
        amounts[0] = liqOpp.maxStablecoinAmountToRepay;

        deal(address(_contractAgToken), liquidator, liqOpp.maxStablecoinAmountToRepay);
        vm.startPrank(liquidator);
        // can try with a to different than liquidator
        _contractVaultManager.liquidate(vaultIDs, amounts, liquidator, liquidator);
        vm.stopPrank();
        _oracle.update(ORACLE_VALUE);
    }

    function _removeVaultFromList(uint256[] storage vaultList, uint256 vaultID) internal {
        uint256 vaultListLength = vaultList.length;
        for (uint256 i = 0; i < vaultListLength - 1; i++) {
            if (vaultList[i] == vaultID) {
                vaultList[i] = vaultList[vaultListLength - 1];
                break;
            }
        }
        vaultList.pop();
    }

    function _compareLists(uint256[] memory expectedVaultList, uint256[] memory vaultList) internal {
        uint256 vaultListLength = vaultList.length;
        assertEq(vaultListLength, expectedVaultList.length);
        for (uint256 i = 0; i < vaultListLength; i++) {
            assertEq(vaultList[i], expectedVaultList[i]);
        }
    }

    function _logArray(uint256[] memory list, address owner) internal view {
        console.log("owner: ", owner);
        for (uint256 i = 0; i < list.length; i++) {
            console.log("owns vaultID: ", list[i]);
        }
    }
}
