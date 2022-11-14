// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "forge-std/Script.sol";
import { console } from "forge-std/console.sol";
import { MockCurveTokenStakerAaveBP } from "../../../contracts/staker/curve/implementations/polygon/polygonTest/MockCurveTokenStakerAaveBP.sol";
import "./PolygonConstants.s.sol";

contract DeploySwapper is Script, PolygonConstants {
    function run() external {
        uint256 deployerPrivateKey = vm.deriveKey(vm.envString("MNEMONIC_POLYGON"), 2);
        vm.rememberKey(deployerPrivateKey);

        vm.startBroadcast(deployerPrivateKey);

        MockCurveTokenStakerAaveBP stakerImplementation = new MockCurveTokenStakerAaveBP();
        MockCurveTokenStakerAaveBP staker = MockCurveTokenStakerAaveBP(
            deployUpgradeable(
                address(stakerImplementation),
                abi.encodeWithSelector(stakerImplementation.initialize.selector, CORE_BORROW)
            )
        );

        console.log(
            "Successfully deployed staker Curve AaveBP implementation at the address: ",
            address(stakerImplementation)
        );
        console.log("Successfully deployed staker Curve AaveBP proxy at the address: ", address(staker));

        vm.stopBroadcast();
    }
}
