// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

import "@openzeppelin/contracts-upgradeable/token/ERC1155/IERC1155ReceiverUpgradeable.sol";

import "./VaultManager.sol";

/// @title VaultManagerERC1155Receiver
/// @author Angle Labs, Inc.
/// @notice VaultManager contract that can receive ERC1155 tokens
contract VaultManagerERC1155Receiver is IERC1155ReceiverUpgradeable, VaultManager {
    /// @inheritdoc IERC1155ReceiverUpgradeable
    /// @dev The returned value should be:
    /// `bytes4(keccak256("onERC1155Received(address,address,uint256,uint256,bytes)")) = 0xf23a6e61`
    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC1155ReceiverUpgradeable.onERC1155Received.selector;
    }

    /// @inheritdoc IERC1155ReceiverUpgradeable
    /// @dev The returned value should be:
    /// `bytes4(keccak256("onERC1155BatchReceived(address,address,uint256[],uint256[],bytes)")) = 0xbc197c81`
    function onERC1155BatchReceived(
        address,
        address,
        uint256[] calldata,
        uint256[] calldata,
        bytes calldata
    ) external pure returns (bytes4) {
        return IERC1155ReceiverUpgradeable.onERC1155BatchReceived.selector;
    }

    /// @inheritdoc IERC165Upgradeable
    function supportsInterface(
        bytes4 interfaceId
    ) external pure override(VaultManagerERC721, IERC165Upgradeable) returns (bool) {
        return
            interfaceId == type(IERC721MetadataUpgradeable).interfaceId ||
            interfaceId == type(IERC721Upgradeable).interfaceId ||
            interfaceId == type(IVaultManager).interfaceId ||
            interfaceId == type(IERC165Upgradeable).interfaceId ||
            interfaceId == type(IERC1155ReceiverUpgradeable).interfaceId;
    }
}
