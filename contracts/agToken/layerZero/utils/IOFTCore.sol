// SPDX-License-Identifier: MIT

pragma solidity 0.8.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/**
 * @dev Interface of the IOFT core standard
 * @dev Forked from https://github.com/LayerZero-Labs/solidity-examples/blob/main/contracts/token/oft/IOFTCore.sol
 */
interface IOFTCore is IERC165 {
    /// @notice Estimates send token `_tokenId` to (`_dstChainId`, `_toAddress`)
    /// @param _dstChainId L0 defined chain id to send tokens too
    /// @param _toAddress dynamic bytes array which contains the address to whom you are sending tokens to on the dstChain
    /// @param _amount amount of the tokens to transfer
    /// @param _useZro indicates to use zro to pay L0 fees
    /// @param _adapterParams flexible bytes array to indicate messaging adapter services in L0
    function estimateSendFee(
        uint16 _dstChainId,
        bytes calldata _toAddress,
        uint256 _amount,
        bool _useZro,
        bytes calldata _adapterParams
    ) external view returns (uint256 nativeFee, uint256 zroFee);

    /// @notice Sends `_amount` amount of token to (`_dstChainId`, `_toAddress`)
    /// @param _dstChainId the destination chain identifier
    /// @param _toAddress can be any size depending on the `dstChainId`.
    /// @param _amount the quantity of tokens in wei
    /// @param _refundAddress the address LayerZero refunds if too much message fee is sent
    /// @param _zroPaymentAddress set to address(0x0) if not paying in ZRO (LayerZero Token)
    /// @param _adapterParams is a flexible bytes array to indicate messaging adapter services
    function send(
        uint16 _dstChainId,
        bytes calldata _toAddress,
        uint256 _amount,
        address payable _refundAddress,
        address _zroPaymentAddress,
        bytes calldata _adapterParams
    ) external payable;

    /// @notice Sends `_amount` amount of token to (`_dstChainId`, `_toAddress`)
    /// @param _dstChainId The destination chain identifier
    /// @param _toAddress Can be any size depending on the `dstChainId`.
    /// @param _amount Quantity of tokens in wei
    /// @param _refundAddress Address LayerZero refunds if too much message fee is sent
    /// @param _zroPaymentAddress Set to address(0x0) if not paying in ZRO (LayerZero Token)
    /// @param _adapterParams Flexible bytes array to indicate messaging adapter services
    /// @param deadline Deadline parameter for the signature to be valid
    /// @dev The `v`, `r`, and `s` parameters are used as signature data
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
    ) external payable;

    /// @dev Emitted when `_amount` tokens are moved from the `_sender` to (`_dstChainId`, `_toAddress`)
    /// `_nonce` is the outbound nonce
    event SendToChain(
        address indexed _sender,
        uint16 indexed _dstChainId,
        bytes indexed _toAddress,
        uint256 _amount,
        uint64 _nonce
    );

    /// @dev Emitted when `_amount` tokens are received from `_srcChainId` into the `_toAddress` on the local chain.
    /// `_nonce` is the inbound nonce.
    event ReceiveFromChain(
        uint16 indexed _srcChainId,
        bytes indexed _srcAddress,
        address indexed _toAddress,
        uint256 _amount,
        uint64 _nonce
    );
}

/// @dev Interface of the OFT standard
interface IOFT is IOFTCore, IERC20 {

}
