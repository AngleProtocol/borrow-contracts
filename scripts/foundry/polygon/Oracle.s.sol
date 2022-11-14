// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "forge-std/Script.sol";
import { console } from "forge-std/console.sol";
import "../../../contracts/interfaces/IOracle.sol";
import "../../../contracts/treasury/Treasury.sol";
import { OracleAaveUSDBPEUR } from "../../../contracts/oracle/implementations/polygon/OracleAaveUSDBP_EUR.sol";
import "./PolygonConstants.s.sol";

contract DeployOracle is Script, PolygonConstants {
    uint32 public constant STALE_PERIOD = 3600 * 24;

    function run() external {
        uint256 deployerPrivateKey = vm.deriveKey(vm.envString("MNEMONIC_POLYGON"), 2);
        vm.startBroadcast(deployerPrivateKey);

        IOracle oracle = new OracleAaveUSDBPEUR(STALE_PERIOD, address(AGEUR_TREASURY));

        console.log("Successfully deployed Oracle Curve AaveBP at the address: ", address(oracle));

        vm.stopBroadcast();
    }
}
