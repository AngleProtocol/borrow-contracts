// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "forge-std/Script.sol";
import { console } from "forge-std/console.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../../contracts/interfaces/IOracle.sol";
import { CurveTokenTricrypto3Staker } from "../../../contracts/staker/curve/implementations/polygon/CurveTokenTricrypto3Staker.sol";
import "./PolygonConstants.s.sol";

contract DeploySwapper is Script, PolygonConstants {
    // TODO to be changed at deployment
    IERC20 public constant ASSET = IERC20(address(0));

    function run() external {
        uint256 deployerPrivateKey = vm.deriveKey(vm.envString("MNEMONIC_POLYGON"), 0);
        vm.startBroadcast(deployerPrivateKey);

        CurveTokenTricrypto3Staker stakerImplementation = new CurveTokenTricrypto3Staker();
        CurveTokenTricrypto3Staker staker = CurveTokenTricrypto3Staker(
            deployUpgradeable(
                address(stakerImplementation),
                abi.encodeWithSelector(stakerImplementation.initialize.selector, CORE_BORROW, ASSET)
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
