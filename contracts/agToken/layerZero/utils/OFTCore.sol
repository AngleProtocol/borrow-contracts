// SPDX-License-Identifier: MIT

pragma solidity 0.8.12;

import "./NonblockingLzApp.sol";
import "./IOFTCore.sol";
import "@openzeppelin/contracts-upgradeable/utils/introspection/ERC165Upgradeable.sol";

/// @title OFTCore
/// @author Forked from https://github.com/LayerZero-Labs/solidity-examples/blob/main/contracts/token/oft/OFTCore.sol
/// but with slight modifications from the Angle Core Team which added return values to the `_creditTo` and `_debitFrom` functions
/// @notice Base contract for bridging using LayerZero
abstract contract OFTCore is NonblockingLzApp, ERC165Upgradeable, IOFTCore {
    // ==================== External Permissionless Functions ======================

    /// @inheritdoc IOFTCore
    function sendWithPermit(
        uint16 _dstChainId,
        bytes memory _toAddress,
        uint256 _amount,
        address payable _refundAddress,
        address _zroPaymentAddress,
        bytes memory _adapterParams,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public payable virtual;

    /// @inheritdoc IOFTCore
    function send(
        uint16 _dstChainId,
        bytes memory _toAddress,
        uint256 _amount,
        address payable _refundAddress,
        address _zroPaymentAddress,
        bytes memory _adapterParams
    ) public payable virtual {
        _amount = _debitFrom(_dstChainId, _toAddress, _amount);

        bytes memory payload = abi.encode(_toAddress, _amount);
        _lzSend(_dstChainId, payload, _refundAddress, _zroPaymentAddress, _adapterParams);

        uint64 nonce = lzEndpoint.getOutboundNonce(_dstChainId, address(this));
        emit SendToChain(msg.sender, _dstChainId, _toAddress, _amount, nonce);
    }

    /// @inheritdoc IOFTCore
    function sendCredit(
        uint16 _dstChainId,
        bytes memory _toAddress,
        uint256 _amount,
        address payable _refundAddress,
        address _zroPaymentAddress,
        bytes memory _adapterParams
    ) public payable virtual {
        _amount = _debitCreditFrom(_dstChainId, _toAddress, _amount);

        _send(_dstChainId, _toAddress, _amount, _refundAddress, _zroPaymentAddress, _adapterParams);
    }

    /// @inheritdoc IOFTCore
    function withdraw(uint256 amount, address recipient) external virtual returns (uint256);

    // =========================== Internal Functions ==============================

    /// @notice Internal function to send `_amount` amount of token to (`_dstChainId`, `_toAddress`)
    /// @param _dstChainId the destination chain identifier
    /// @param _toAddress can be any size depending on the `dstChainId`.
    /// @param _amount the quantity of tokens in wei
    /// @param _refundAddress the address LayerZero refunds if too much message fee is sent
    /// @param _zroPaymentAddress set to address(0x0) if not paying in ZRO (LayerZero Token)
    /// @param _adapterParams is a flexible bytes array to indicate messaging adapter services
    /// @dev Accounting and checks should be performed beforehand
    function _send(
        uint16 _dstChainId,
        bytes memory _toAddress,
        uint256 _amount,
        address payable _refundAddress,
        address _zroPaymentAddress,
        bytes memory _adapterParams
    ) internal {
        bytes memory payload = abi.encode(_toAddress, _amount);
        _lzSend(_dstChainId, payload, _refundAddress, _zroPaymentAddress, _adapterParams);

        uint64 nonce = lzEndpoint.getOutboundNonce(_dstChainId, address(this));
        emit SendToChain(msg.sender, _dstChainId, _toAddress, _amount, nonce);
    }

    /// @inheritdoc NonblockingLzApp
    function _nonblockingLzReceive(
        uint16 _srcChainId,
        bytes memory _srcAddress,
        uint64 _nonce,
        bytes memory _payload
    ) internal virtual override {
        // decode and load the toAddress
        (bytes memory toAddressBytes, uint256 amount) = abi.decode(_payload, (bytes, uint256));
        address toAddress;
        //solhint-disable-next-line
        assembly {
            toAddress := mload(add(toAddressBytes, 20))
        }
        amount = _creditTo(_srcChainId, toAddress, amount);

        emit ReceiveFromChain(_srcChainId, _srcAddress, toAddress, amount, _nonce);
    }

    /// @notice Makes accountability when bridging from this contract using canonical token
    /// @param _dstChainId ChainId of the destination chain - LayerZero standard
    /// @param _toAddress Recipient on the destination chain
    /// @param _amount Amount to bridge
    function _debitFrom(
        uint16 _dstChainId,
        bytes memory _toAddress,
        uint256 _amount
    ) internal virtual returns (uint256);

    /// @notice Makes accountability when bridging from this contract's credit
    /// @param _dstChainId ChainId of the destination chain - LayerZero standard
    /// @param _toAddress Recipient on the destination chain
    /// @param _amount Amount to bridge
    function _debitCreditFrom(
        uint16 _dstChainId,
        bytes memory _toAddress,
        uint256 _amount
    ) internal virtual returns (uint256);

    /// @notice Makes accountability when bridging to this contract
    /// @param _srcChainId ChainId of the source chain - LayerZero standard
    /// @param _toAddress Recipient on this chain
    /// @param _amount Amount to bridge
    function _creditTo(
        uint16 _srcChainId,
        address _toAddress,
        uint256 _amount
    ) internal virtual returns (uint256);

    // ========================== View Functions ===================================

    /// @inheritdoc ERC165Upgradeable
    function supportsInterface(bytes4 interfaceId)
        public
        view
        virtual
        override(ERC165Upgradeable, IERC165)
        returns (bool)
    {
        return interfaceId == type(IOFTCore).interfaceId || super.supportsInterface(interfaceId);
    }

    /// @inheritdoc IOFTCore
    function estimateSendFee(
        uint16 _dstChainId,
        bytes memory _toAddress,
        uint256 _amount,
        bool _useZro,
        bytes memory _adapterParams
    ) public view virtual override returns (uint256 nativeFee, uint256 zroFee) {
        // mock the payload for send()
        bytes memory payload = abi.encode(_toAddress, _amount);
        return lzEndpoint.estimateFees(_dstChainId, address(this), payload, _useZro, _adapterParams);
    }

    uint256[50] private __gap;
}
