// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.17;

import "forge-std/Script.sol";
import { SanFRAXEURERC4626AdapterStakable } from "../../../contracts/adapters/implementations/Stakable/SanFRAXEURERC4626AdapterStakable.sol";
import "./MainnetConstants.s.sol";

contract DeploySanTokenAdapterMainnet is Script, MainnetConstants {
    SanFRAXEURERC4626AdapterStakable public adapter;
    address public constant ADAPTER_IMPL = address(0);

    function run() external {
        uint256 deployerPrivateKey = vm.deriveKey(vm.envString("MNEMONIC_MAINNET"), 0);
        vm.startBroadcast(deployerPrivateKey);
        bytes memory data;

        adapter = SanFRAXEURERC4626AdapterStakable(deployUpgradeable(address(ADAPTER_IMPL), data));
        adapter.initialize();

        console.log("Successfully deployed ERC4626 Adapter at the address: ", address(adapter));

        vm.stopBroadcast();
    }
}
