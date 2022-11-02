// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.12;

import { Test, stdMath, StdStorage, stdStorage } from "forge-std/Test.sol";
import "../../contracts/external/ProxyAdmin.sol";
import "../../contracts/external/TransparentUpgradeableProxy.sol";
import "../../contracts/mock/MockCoreBorrow.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { console } from "forge-std/console.sol";

contract BaseTest is Test {
    ProxyAdmin public proxyAdmin;
    MockCoreBorrow public coreBorrow;

    address internal constant _GOVERNOR = 0xdC4e6DFe07EFCa50a197DF15D9200883eF4Eb1c8;
    address internal constant _GUARDIAN = 0x0C2553e4B9dFA9f83b1A6D3EAB96c4bAaB42d430;
    address internal constant _KEEPER = address(uint160(uint256(keccak256(abi.encodePacked("_keeper")))));
    address internal constant _ANGLE = 0x31429d1856aD1377A8A0079410B297e1a9e214c2;

    address internal constant _alice = address(uint160(uint256(keccak256(abi.encodePacked("_alice")))));
    address internal constant _bob = address(uint160(uint256(keccak256(abi.encodePacked("_bob")))));
    address internal constant _charlie = address(uint160(uint256(keccak256(abi.encodePacked("_charlie")))));
    address internal constant _dylan = address(uint160(uint256(keccak256(abi.encodePacked("_dylan")))));

    uint256 internal _ethereum;
    uint256 internal _polygon;

    uint256 public constant BASE_PARAMS = 10**36;

    function setUp() public virtual {
        proxyAdmin = new ProxyAdmin();
        coreBorrow = new MockCoreBorrow();
        coreBorrow.toggleGuardian(_GUARDIAN);
        coreBorrow.toggleGovernor(_GOVERNOR);
        vm.label(_GOVERNOR, "Governor");
        vm.label(_GUARDIAN, "Guardian");
        vm.label(_alice, "Alice");
        vm.label(_bob, "Bob");
        vm.label(_charlie, "Charlie");
        vm.label(_dylan, "Dylan");
    }

    function deployUpgradeable(address implementation, bytes memory data) public returns (address) {
        return address(new TransparentUpgradeableProxy(implementation, address(proxyAdmin), data));
    }
}
