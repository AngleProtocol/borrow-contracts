// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "forge-std/Script.sol";
import { console } from "forge-std/console.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../../contracts/interfaces/IOracle.sol";
import { MockCurveTokenTricrypto3Staker } from "../../../contracts/staker/curve/implementations/polygon/polygonTest/MockCurveTokenTricrypto3Staker.sol";
import "./PolygonConstants.s.sol";

contract DeploySwapper is Script, PolygonConstants {
    function run() external {
        uint256 deployerPrivateKey = vm.deriveKey(vm.envString("MNEMONIC_POLYGON"), 2);
        address deployer = vm.rememberKey(deployerPrivateKey);

        vm.startBroadcast(deployerPrivateKey);

        MockCurveTokenTricrypto3Staker stakerImplementation = new MockCurveTokenTricrypto3Staker();
        MockCurveTokenTricrypto3Staker staker = MockCurveTokenTricrypto3Staker(
            deployUpgradeable(
                address(stakerImplementation),
                abi.encodeWithSelector(stakerImplementation.initialize.selector, CORE_BORROW)
            )
        );

        console.log(
            "Successfully deployed staker tricrypto implementation at the address: ",
            address(stakerImplementation)
        );
        console.log("Successfully deployed staker tricrypto proxy at the address: ", address(staker));

        vm.stopBroadcast();
    }
}
