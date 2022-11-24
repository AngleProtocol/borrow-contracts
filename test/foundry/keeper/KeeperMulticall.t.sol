// SPDX-License-Identifier: MIT
pragma solidity ^0.8.12;

import { console } from "forge-std/console.sol";
import { Test } from "forge-std/Test.sol";
import "../../../contracts/keeperMulticall/KeeperMulticall.sol";
import "../../../contracts/mock/MockToken.sol";

contract KeeperMulticallTest is Test {
    KeeperMulticall internal _contractKeeperMulticall;
    MockToken internal _mockToken;

    address internal _keeper = address(uint160(uint256(keccak256(abi.encodePacked("keeper")))));
    address internal _coinbase = address(uint160(uint256(keccak256(abi.encodePacked("coinbase")))));

    function setUp() public virtual {
        _contractKeeperMulticall = new KeeperMulticall();
        _mockToken = new MockToken("Name", "SYM", 18);

        // reset `_initialized` slot
        vm.store(address(_contractKeeperMulticall), bytes32(uint256(0)), bytes32(uint256(0)));
        _contractKeeperMulticall.initialize(_keeper);
    }

    function testPayFlashbots() public {
        vm.coinbase(_coinbase);
        vm.deal(address(_contractKeeperMulticall), 10);
        startHoax(_keeper);

        uint256 preBalance = address(_coinbase).balance;
        _contractKeeperMulticall.payFlashbots(10);
        uint256 postBalance = address(_coinbase).balance;

        assertEq(preBalance + 10, postBalance);
    }

    function testFuzzAllowance(address spender, uint256 amount) public {
        vm.assume(spender != address(0));
        startHoax(_keeper);
        _contractKeeperMulticall.approve(_mockToken, spender, amount);
        assertEq(_mockToken.allowance(address(_contractKeeperMulticall), spender), amount);
    }

    function testFuzzFinalBalanceCheck(uint256 amount) public {
        uint256 balance = 10 ether;
        deal(address(_mockToken), address(_contractKeeperMulticall), balance);
        startHoax(_keeper);

        IERC20[] memory tokens = new IERC20[](1);
        tokens[0] = IERC20(_mockToken);

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = amount;

        if (amount > balance) {
            vm.expectRevert(KeeperMulticall.BalanceTooLow.selector);
        }
        _contractKeeperMulticall.finalBalanceCheck(tokens, amounts);
    }

    function testFuzzWithdrawStuckFunds(uint256 balanceToken) public {
        console.log(_mockToken.balanceOf(address(_contractKeeperMulticall)));
        address receiver = address(uint160(uint256(keccak256(abi.encodePacked("receiver")))));

        deal(address(_mockToken), address(_contractKeeperMulticall), balanceToken);
        assertEq(_mockToken.balanceOf(address(_contractKeeperMulticall)), balanceToken);

        vm.deal(address(_contractKeeperMulticall), balanceToken);
        assertEq(address(_contractKeeperMulticall).balance, balanceToken);

        vm.prank(_keeper);
        _contractKeeperMulticall.withdrawStuckFunds(address(_mockToken), receiver, balanceToken);
        assertEq(_mockToken.balanceOf(address(_contractKeeperMulticall)), 0);
        assertEq(_mockToken.balanceOf(address(receiver)), balanceToken);

        vm.prank(_keeper);
        _contractKeeperMulticall.withdrawStuckFunds(0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE, receiver, balanceToken);
        assertEq(address(_contractKeeperMulticall).balance, 0);
        assertEq(address(receiver).balance, balanceToken);
    }
}
