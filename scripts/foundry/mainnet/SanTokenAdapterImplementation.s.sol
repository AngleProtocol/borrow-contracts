// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.17;

import "forge-std/Script.sol";
import { SanFRAXEURERC4626AdapterStakable } from "../../../contracts/adapters/implementations/Stakable/SanFRAXEURERC4626AdapterStakable.sol";

contract DeploySanTokenAdapterImplementationsMainnet is Script {
    SanFRAXEURERC4626AdapterStakable public adapterImplementation;

    function run() external {
        uint256 deployerPrivateKey = vm.deriveKey(vm.envString("MNEMONIC_MAINNET"), 0);
        vm.startBroadcast(deployerPrivateKey);

        adapterImplementation = new SanFRAXEURERC4626AdapterStakable();

        console.log("Successfully deployed ERC4626 Adapter at the address: ", address(adapterImplementation));

        vm.stopBroadcast();
    }
}
