// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "forge-std/Script.sol";
import { VaultManagerListing } from "../../../contracts/vaultManager/VaultManagerListing.sol";
import "./PolygonConstants.s.sol";

contract DeployVaultManagerImplementation is Script, PolygonConstants {
    VaultManagerListing public vaultManagerImplementation;

    function run() external {
        uint256 deployerPrivateKey = vm.deriveKey(vm.envString("MNEMONIC_POLYGON"), 2);
        vm.startBroadcast(deployerPrivateKey);

        vaultManagerImplementation = new VaultManagerListing(0, 0);

        console.log(
            "Successfully deployed vaultManagerImplementation at the address: ",
            address(vaultManagerImplementation)
        );

        vm.stopBroadcast();
    }
}
