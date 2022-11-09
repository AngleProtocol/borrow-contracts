// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import { console } from "forge-std/console.sol";
import { stdStorage, StdStorage, Test } from "forge-std/Test.sol";
import { VaultManager } from "../../../contracts/vaultManager/VaultManager.sol";

contract SlotFinder is Test {
    using stdStorage for StdStorage;

    VaultManager internal _contractVaultManager;

    function setUp() public virtual {
        _contractVaultManager = new VaultManager(10, 10);
    }

    function testFindSlot() public {
        uint256 slot = stdstore
            .target(address(_contractVaultManager))
            .sig(_contractVaultManager.treasury.selector)
            .find();
        console.log("slot", slot);

        vm.record();

        _contractVaultManager.name();
        (bytes32[] memory reads, ) = vm.accesses(address(_contractVaultManager));
        console.log("slot `name`: ", uint256(reads[0]));

        _contractVaultManager.treasury();
        (reads, ) = vm.accesses(address(_contractVaultManager));
        console.log("slot `treasury`: ", uint256(reads[0]));

        _contractVaultManager.stablecoin();
        (reads, ) = vm.accesses(address(_contractVaultManager));
        console.log("slot `stablecoin`: ", uint256(reads[0]));
    }
}
