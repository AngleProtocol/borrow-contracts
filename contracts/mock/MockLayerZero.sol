// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

interface ILzApp {
    function lzReceive(uint16 _srcChainId, bytes memory _srcAddress, uint64 _nonce, bytes memory _payload) external;
}

contract MockLayerZero {
    mapping(uint16 => uint256) public counters;
    uint256 public config;
    mapping(uint16 => uint64) public outboundNonce;
    uint256 public resumeReceived;
    uint256 public sendVersion;
    uint256 public receiveVersion;

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

    function estimateFees(
        uint16,
        address,
        bytes calldata,
        bool,
        bytes calldata
    ) external pure returns (uint256 nativeFee, uint256 zroFee) {
        return (123, 456);
    }

    function setConfig(uint16, uint16, uint256 _configType, bytes calldata) external {
        config = _configType;
    }

    function getConfig(uint16, uint16, address, uint256) external view returns (bytes memory) {
        return abi.encodePacked(config);
    }

    function setSendVersion(uint16 _version) external {
        sendVersion = _version;
    }

    function setReceiveVersion(uint16 _version) external {
        receiveVersion = _version;
    }

    function forceResumeReceive(uint16, bytes calldata) external {
        resumeReceived = 1 - resumeReceived;
    }
}
