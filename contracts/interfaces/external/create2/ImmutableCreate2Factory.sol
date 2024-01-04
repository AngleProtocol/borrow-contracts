// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

interface ImmutableCreate2Factory {
    function safeCreate2(bytes32 salt, bytes memory initCode) external payable returns (address deploymentAddress);

    function findCreate2Address(
        bytes32 salt,
        bytes calldata initCode
    ) external view returns (address deploymentAddress);

    function findCreate2AddressViaHash(
        bytes32 salt,
        bytes32 initCodeHash
    ) external view returns (address deploymentAddress);
}
