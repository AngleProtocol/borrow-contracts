// SPDX-License-Identifier: MIT
pragma solidity ^0.8.12;

import { console } from "forge-std/console.sol";
import { stdStorage, StdStorage, Test } from "forge-std/Test.sol";
import { VaultManager, VaultManagerStorage } from "../../../contracts/vaultManager/VaultManager.sol";
import { ActionType, VaultParameters } from "../../../contracts/interfaces/IVaultManager.sol";
import { Treasury } from "../../../contracts/treasury/Treasury.sol";
import { MockStableMaster } from "../../../contracts/mock/MockStableMaster.sol";
import "../../../contracts/mock/MockOracle.sol";
import "../../../contracts/mock/MockToken.sol";
import { CoreBorrow } from "../../../contracts/coreBorrow/CoreBorrow.sol";
import { AgToken } from "../../../contracts/agToken/AgToken.sol";

contract VaultManagerTest is Test {
    using stdStorage for StdStorage;

    address internal _user = address(uint160(uint256(keccak256(abi.encodePacked("user")))));

    address internal _governor = address(uint160(uint256(keccak256(abi.encodePacked("governor")))));
    address internal _guardian = address(uint160(uint256(keccak256(abi.encodePacked("guardian")))));

    MockStableMaster internal _contractStableMaster;
    VaultManager internal _contractVaultManager;
    CoreBorrow internal _contractCoreBorrow;
    Treasury internal _contractTreasury;
    AgToken internal _contractAgToken;

    MockToken internal _collateral;
    MockOracle internal _oracle;

    function setUp() public virtual {
        _contractStableMaster = new MockStableMaster();

        _contractAgToken = new AgToken();
        vm.store(address(_contractAgToken), bytes32(uint256(0)), bytes32(uint256(0)));
        _contractAgToken.initialize("agEUR", "agEUR", address(_contractStableMaster));

        _contractCoreBorrow = new CoreBorrow();
        vm.store(address(_contractCoreBorrow), bytes32(uint256(0)), bytes32(uint256(0)));
        _contractCoreBorrow.initialize(_governor, _guardian);

        _contractTreasury = new Treasury();
        vm.store(address(_contractTreasury), bytes32(uint256(0)), bytes32(uint256(0)));
        _contractTreasury.initialize(_contractCoreBorrow, _contractAgToken);

        _oracle = new MockOracle(5 ether, _contractTreasury);
        _collateral = new MockToken("Name", "SYM", 18);

        _contractVaultManager = new VaultManager();
        vm.store(address(_contractVaultManager), bytes32(uint256(0)), bytes32(uint256(0)));

        VaultParameters memory params = VaultParameters({
            debtCeiling: 100 ether,
            collateralFactor: 0.5e9,
            targetHealthFactor: 1.1e9,
            interestRate: 1.547e18,
            liquidationSurcharge: 0.9e9,
            maxLiquidationDiscount: 0.1e9,
            whitelistingActivated: false,
            baseBoost: 1e9
        });
        _contractVaultManager.initialize(_contractTreasury, _collateral, _oracle, params, "wETH");

        vm.prank(0xdC4e6DFe07EFCa50a197DF15D9200883eF4Eb1c8);
        _contractAgToken.setUpTreasury(address(_contractTreasury));

        vm.startPrank(_governor);
        _contractVaultManager.togglePause();
        _contractTreasury.addVaultManager(address(_contractVaultManager));
        vm.stopPrank();
    }

    function testOracle() public {
        assertEq(_oracle.read(), 5 ether);
    }

    function testFuzzCreateVault(uint256 collateralAmount, uint256 borrowAmount) public {
        uint256 collateralBalance = 1 ether;

        vm.assume(collateralAmount <= collateralBalance);
        // vm.assume(borrowAmount > _contractVaultManager.dust());
        // vm.assume(borrowAmount < _contractVaultManager.debtCeiling());
        borrowAmount = bound(borrowAmount, _contractVaultManager.dust() + 1, _contractVaultManager.debtCeiling() - 1);

        deal(address(_collateral), _user, collateralBalance);

        uint256 numberActions = 3;

        ActionType[] memory actions = new ActionType[](numberActions);
        actions[0] = ActionType.createVault;
        actions[1] = ActionType.addCollateral;
        actions[2] = ActionType.borrow;

        bytes[] memory datas = new bytes[](numberActions);
        datas[0] = abi.encode(_user);
        datas[1] = abi.encode(0, collateralAmount);
        datas[2] = abi.encode(0, borrowAmount);

        assertEq(_contractVaultManager.vaultIDCount(), 0);

        vm.startPrank(_user);
        _collateral.approve(address(_contractVaultManager), 1 ether);

        uint256 oracleValue = _oracle.read();
        uint256 collateralFactor = _contractVaultManager.collateralFactor();
        uint256 maxBorrow = (((oracleValue * collateralAmount) / 1e18) * collateralFactor) / 1e9 - 1;

        console.log(oracleValue, collateralFactor, borrowAmount, maxBorrow);
        if (borrowAmount > maxBorrow) {
            vm.expectRevert(VaultManagerStorage.InsolventVault.selector);
        }
        _contractVaultManager.angle(actions, datas, _user, _user);
        vm.stopPrank();

        if (borrowAmount <= maxBorrow) {
            assertEq(_contractVaultManager.vaultIDCount(), 1);

            (uint256 collateralValue, uint256 normalizedDebt) = _contractVaultManager.vaultData(1);
            uint256 debt = _contractVaultManager.getVaultDebt(1);

            assertEq(collateralValue, collateralAmount);
            assertEq(normalizedDebt, borrowAmount);
            assertEq(debt, borrowAmount);
        }
    }
}
