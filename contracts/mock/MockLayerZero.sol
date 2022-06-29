// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

interface ILzApp {
    function lzReceive(
        uint16 _srcChainId,
        bytes memory _srcAddress,
        uint64 _nonce,
        bytes memory _payload
    ) external;
}

contract MockLayerZero {
    mapping(uint16 => uint256) public counters;
    uint256 public config;
    mapping(uint16 => uint64) public outboundNonce;

    /// @notice Initiate with a fixe change rate
    constructor() {}

    function send(
        uint16 _dstChainId,
        bytes calldata,
        bytes calldata,
        address,
        address,
        bytes calldata
    ) external payable {
        counters[_dstChainId] += 1;
    }

    function getOutboundNonce(uint16 _dstChainId, address) external view returns (uint64) {
        return outboundNonce[_dstChainId];
    }

    function setOutBoundNonce(uint16 _from, uint64 value) external {
        outboundNonce[_from] = value;
    }

    function lzReceive(
        address lzApp,
        uint16 _srcChainId,
        bytes memory _srcAddress,
        uint64 _nonce,
        bytes memory _payload
    ) public {
        ILzApp(lzApp).lzReceive(_srcChainId, _srcAddress, _nonce, _payload);
    }
}
