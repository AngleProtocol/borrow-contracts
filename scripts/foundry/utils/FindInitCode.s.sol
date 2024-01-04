// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.17;

import { Utils } from "./Utils.s.sol";
import { console } from "forge-std/console.sol";
import { stdJson } from "forge-std/StdJson.sol";
import "stringutils/strings.sol";

import "./Constants.s.sol";
import { TransparentUpgradeableProxy } from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";

import { ImmutableCreate2Factory } from "../../../contracts/interfaces/external/create2/ImmutableCreate2Factory.sol";

/// @dev Script to run to find the init code of a contract to get a vanity address from it
contract FindInitCode is Utils {
    using stdJson for string;
    using strings for *;

    function run() external {
        // To maintain chain consistency, we do as if we deployed with the deployer as a proxyAdmin before transferring
        // to another address
        // We use a contract that is widely deployed across many chains as an implementation to make it resilient
        // to possible implementation changes
        bytes memory emptyData;
        bytes memory initCode = abi.encodePacked(
            type(TransparentUpgradeableProxy).creationCode,
            abi.encode(IMMUTABLE_CREATE2_FACTORY_ADDRESS, DEPLOYER, emptyData)
        );
        console.log("Proxy bytecode");
        console.logBytes(initCode);
        console.log("");
    }
}
