// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "forge-std/Script.sol";
import "../../../contracts/vaultManager/vaultManager.sol";
import "./PolygonConstants.s.sol";

contract DeployVaultManager is Script, PolygonConstants {
    VaultManager public vaultManagerImplementation;

    function run() external {
        uint256 deployerPrivateKey = vm.deriveKey(vm.envString("MNEMONIC_POLYGON"), 0);
        vm.startBroadcast(deployerPrivateKey);

        vaultManagerImplementation = new VaultManager(0, 0);

        console.log(
            "Successfully deployed vaultManagerImplementation at the address: ",
            address(vaultManagerImplementation)
        );

        vm.stopBroadcast();
    }
}
