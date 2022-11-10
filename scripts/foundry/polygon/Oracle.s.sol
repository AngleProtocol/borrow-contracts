// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "forge-std/Script.sol";
import { console } from "forge-std/console.sol";
import "../../../contracts/interfaces/IOracle.sol";
import "../../../contracts/treasury/Treasury.sol";
import { OracleCrvUSDBTCETHEUR } from "../../../contracts/oracle/implementations/polygon/OracleCrvUSDBTCETH_EUR.sol";
import "./PolygonConstants.s.sol";

contract DeployOracle is Script, PolygonConstants {
    // AGEUR Polygon treasury
    address public constant TREASURY = 0x2F2e0ba9746aae15888cf234c4EB5B301710927e;

    // TODO to be changed at deployment depending on the vaultManager
    uint32 public constant STALE_PERIOD = 3600 * 24;

    function run() external {
        uint256 deployerPrivateKey = vm.deriveKey(vm.envString("MNEMONIC_POLYGON"), 0);
        vm.startBroadcast(deployerPrivateKey);

        IOracle oracle = new OracleCrvUSDBTCETHEUR(STALE_PERIOD, address(TREASURY));

        console.log("Successfully deployed Oracle tricrypto3 at the address: ", address(oracle));

        vm.stopBroadcast();
    }
}
