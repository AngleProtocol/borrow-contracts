// SPDX-License-Identifier: MIT

pragma solidity 0.8.12;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../../interfaces/external/layerZero/ILayerZeroReceiver.sol";
import "../../interfaces/external/layerZero/ILayerZeroUserApplicationConfig.sol";
import "../../interfaces/external/layerZero/ILayerZeroEndpoint.sol";
import "../../interfaces/ITreasury.sol";

/// @title LzApp
/// @author Angle Core Team, forked from LayerZero
abstract contract LzApp is ILayerZeroReceiver, ILayerZeroUserApplicationConfig {
    /// @notice Layer Zero endpoint
    ILayerZeroEndpoint public immutable lzEndpoint;

    /// @notice Maps chainIds to their OFT address
    mapping(uint16 => bytes) public trustedRemoteLookup;

    /// @notice Reference to the treasury contract to fetch access control
    address public immutable treasury;

    // ================================== Events ===================================

    event SetTrustedRemote(uint16 _srcChainId, bytes _srcAddress);

    // =============================== Errors ================================

    error NotGovernor();
    error NotGovernorOrGuardian();
    error InvalidEndpoint();
    error InvalidSource();

    // ============================= Constructor ===================================

    constructor(address _endpoint, address _treasury) {
        lzEndpoint = ILayerZeroEndpoint(_endpoint);
        treasury = _treasury;
    }

    // =============================== Modifiers ===================================

    /// @notice Checks whether the `msg.sender` has the governor role or not
    modifier onlyGovernor() {
        if (!ITreasury(treasury).isGovernor(msg.sender)) revert NotGovernor();
        _;
    }

    /// @notice Checks whether the `msg.sender` has the governor role or the guardian role
    modifier onlyGovernorOrGuardian() {
        if (!ITreasury(treasury).isGovernorOrGuardian(msg.sender)) revert NotGovernorOrGuardian();
        _;
    }

    // ==================== External Permissionless Functions ======================

    function lzReceive(
        uint16 _srcChainId,
        bytes memory _srcAddress,
        uint64 _nonce,
        bytes memory _payload
    ) public virtual override {
        // lzReceive must be called by the endpoint for security
        if (msg.sender != address(lzEndpoint)) revert InvalidEndpoint();

        bytes memory trustedRemote = trustedRemoteLookup[_srcChainId];
        // if will still block the message pathway from (srcChainId, srcAddress). should not receive message from untrusted remote.
        if (_srcAddress.length != trustedRemote.length || keccak256(_srcAddress) != keccak256(trustedRemote))
            revert InvalidSource();

        _blockingLzReceive(_srcChainId, _srcAddress, _nonce, _payload);
    }

    // abstract function - the default behaviour of LayerZero is blocking. See: NonblockingLzApp if you dont need to enforce ordered messaging
    function _blockingLzReceive(
        uint16 _srcChainId,
        bytes memory _srcAddress,
        uint64 _nonce,
        bytes memory _payload
    ) internal virtual;

    function _lzSend(
        uint16 _dstChainId,
        bytes memory _payload,
        address payable _refundAddress,
        address _zroPaymentAddress,
        bytes memory _adapterParams
    ) internal virtual {
        bytes memory trustedRemote = trustedRemoteLookup[_dstChainId];
        if (trustedRemote.length == 0) revert InvalidSource();
        lzEndpoint.send{ value: msg.value }(
            _dstChainId,
            trustedRemote,
            _payload,
            _refundAddress,
            _zroPaymentAddress,
            _adapterParams
        );
    }

    // ======================= Governance Functions ================================

    function getConfig(
        uint16 _version,
        uint16 _chainId,
        address,
        uint256 _configType
    ) external view returns (bytes memory) {
        return lzEndpoint.getConfig(_version, _chainId, address(this), _configType);
    }

    // generic config for LayerZero user Application
    function setConfig(
        uint16 _version,
        uint16 _chainId,
        uint256 _configType,
        bytes calldata _config
    ) external override onlyGovernorOrGuardian {
        lzEndpoint.setConfig(_version, _chainId, _configType, _config);
    }

    function setSendVersion(uint16 _version) external override onlyGovernorOrGuardian {
        lzEndpoint.setSendVersion(_version);
    }

    function setReceiveVersion(uint16 _version) external override onlyGovernorOrGuardian {
        lzEndpoint.setReceiveVersion(_version);
    }

    function forceResumeReceive(uint16 _srcChainId, bytes calldata _srcAddress)
        external
        override
        onlyGovernorOrGuardian
    {
        lzEndpoint.forceResumeReceive(_srcChainId, _srcAddress);
    }

    // allow owner to set it multiple times.
    function setTrustedRemote(uint16 _srcChainId, bytes calldata _srcAddress) external onlyGovernorOrGuardian {
        trustedRemoteLookup[_srcChainId] = _srcAddress;
        emit SetTrustedRemote(_srcChainId, _srcAddress);
    }

    //--------------------------- VIEW FUNCTION ----------------------------------------

    function isTrustedRemote(uint16 _srcChainId, bytes calldata _srcAddress) external view returns (bool) {
        bytes memory trustedSource = trustedRemoteLookup[_srcChainId];
        return keccak256(trustedSource) == keccak256(_srcAddress);
    }
}
