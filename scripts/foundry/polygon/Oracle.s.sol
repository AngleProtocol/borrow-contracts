// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "forge-std/Script.sol";
import "../../../contracts/interfaces/IOracle.sol";
import "../../../contracts/treasury/Treasury.sol";
import "./PolygonConstants.s.sol";

contract DeployAMOBP is Script, PolygonConstants {
    // AGEUR treasury
    address public constant TREASURY = 0x1a7e4e63778B4f12a199C062f3eFdD288afCBce8;

    // TODO to be changed at deployment depending on the vaultManager
    uint256 public constant STALE_PERIOD = 3600 * 24;

    error ZeroAdress();

    function run() external {
        uint256 deployerPrivateKey = vm.deriveKey(vm.envString("MNEMONIC_POLYGON"), 0);
        vm.startBroadcast(deployerPrivateKey);

        vm.stopBroadcast();
    }
}
