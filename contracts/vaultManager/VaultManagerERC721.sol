// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.10;

import "./VaultManagerStorage.sol";

/// @title VaultManagerERC721
/// @author Angle Core Team
/// @dev Base ERC721 Implementation of VaultManager
// solhint-disable-next-line max-states-count
contract VaultManagerERC721 is IERC721MetadataUpgradeable, VaultManagerStorage {
    using SafeERC20 for IERC20;
    using CountersUpgradeable for CountersUpgradeable.Counter;
    using Address for address;

    /// @inheritdoc IERC721MetadataUpgradeable
    string public override name;
    /// @inheritdoc IERC721MetadataUpgradeable
    string public override symbol;

    // ============================== Modifiers ====================================

    /// @notice Checks if the person interacting with the vault with `vaultID` is approved
    /// @param caller Address of the person seeking to interact with the vault
    /// @param vaultID ID of the concerned vault
    modifier onlyApprovedOrOwner(address caller, uint256 vaultID) {
        require(_isApprovedOrOwner(caller, vaultID), "16");
        _;
    }

    // =============================== ERC721 Logic ================================

    /// @notice Returns all the vaults owned or controlled (under the form of approval) by an address
    /// @param spender Address for which vault ownerships should be checked
    /// @return List of `vaultID` controlled by this address
    /// @dev This function is never to be called on-chain since it iterates over all addresses and is here
    /// to reduce dependency on an external graph to link an ID to its owner
    function getControlledVaults(address spender) external view returns (uint256[] memory, uint256) {
        uint256 arraySize = _vaultIDCount.current();
        uint256[] memory vaultsControlled = new uint256[](arraySize);
        address owner;
        uint256 count;
        for (uint256 i = 1; i <= _vaultIDCount.current(); i++) {
            owner = _owners[i];
            if (spender == owner || _getApproved(i) == spender || _operatorApprovals[owner][spender]) {
                vaultsControlled[count] = i;
                count += 1;
            }
        }
        return (vaultsControlled, count);
    }

    /// @notice Checks whether a given address is approved for a vault or owns this vault
    /// @param spender Address for which vault ownership should be checked
    /// @param vaultID ID of the vault to check
    /// @return Whether the `spender` address owns or is approved for `vaultID`
    function isApprovedOrOwner(address spender, uint256 vaultID) external view returns (bool) {
        return _isApprovedOrOwner(spender, vaultID);
    }

    /// @inheritdoc IERC721MetadataUpgradeable
    function tokenURI(uint256 vaultID) external view override returns (string memory) {
        require(_exists(vaultID), "26");
        // There is no vault with `vaultID` equal to 0, so the following variable is
        // always greater than zero
        uint256 temp = vaultID;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (vaultID != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(vaultID % 10)));
            vaultID /= 10;
        }
        return bytes(baseURI).length > 0 ? string(abi.encodePacked(baseURI, string(buffer))) : "";
    }

    /// @inheritdoc IERC721Upgradeable
    function balanceOf(address owner) external view override returns (uint256) {
        require(owner != address(0), "0");
        return _balances[owner];
    }

    /// @inheritdoc IERC721Upgradeable
    function ownerOf(uint256 vaultID) external view override returns (address) {
        return _ownerOf(vaultID);
    }

    /// @inheritdoc IERC721Upgradeable
    function approve(address to, uint256 vaultID) external override {
        address owner = _ownerOf(vaultID);
        require(to != owner, "27");
        require(msg.sender == owner || isApprovedForAll(owner, msg.sender), "16");

        _approve(to, vaultID);
    }

    /// @inheritdoc IERC721Upgradeable
    function getApproved(uint256 vaultID) external view override returns (address) {
        require(_exists(vaultID), "26");
        return _getApproved(vaultID);
    }

    /// @inheritdoc IERC721Upgradeable
    function setApprovalForAll(address operator, bool approved) external override {
        require(operator != msg.sender, "28");
        _operatorApprovals[msg.sender][operator] = approved;
        emit ApprovalForAll(_msgSender(), operator, approved);
    }

    /// @inheritdoc IERC721Upgradeable
    function isApprovedForAll(address owner, address operator) public view override returns (bool) {
        return _operatorApprovals[owner][operator];
    }

    /// @inheritdoc IERC721Upgradeable
    function transferFrom(
        address from,
        address to,
        uint256 vaultID
    ) external override onlyApprovedOrOwner(msg.sender, vaultID) {
        _transfer(from, to, vaultID);
    }

    /// @inheritdoc IERC721Upgradeable
    function safeTransferFrom(
        address from,
        address to,
        uint256 vaultID
    ) external override {
        safeTransferFrom(from, to, vaultID, "");
    }

    /// @inheritdoc IERC721Upgradeable
    function safeTransferFrom(
        address from,
        address to,
        uint256 vaultID,
        bytes memory _data
    ) public override onlyApprovedOrOwner(msg.sender, vaultID) {
        _safeTransfer(from, to, vaultID, _data);
    }

    // =============================== ERC165 logic ================================

    /// @inheritdoc IERC165Upgradeable
    function supportsInterface(bytes4 interfaceId) external pure override(IERC165Upgradeable) returns (bool) {
        return
            interfaceId == type(IERC721MetadataUpgradeable).interfaceId ||
            interfaceId == type(IERC721Upgradeable).interfaceId ||
            interfaceId == type(IVaultManager).interfaceId ||
            interfaceId == type(IERC165Upgradeable).interfaceId;
    }

    // ============== Internal Functions for the ERC721 Logic ======================

    /// @notice Internal version of the `ownerOf` function
    function _ownerOf(uint256 vaultID) internal view returns (address owner) {
        owner = _owners[vaultID];
        require(owner != address(0), "26");
    }

    /// @notice Internal version of the `getApproved` function
    function _getApproved(uint256 vaultID) internal view returns (address) {
        return _vaultApprovals[vaultID];
    }

    /// @notice Internal version of the `safeTransferFrom` function (with the data parameter)
    function _safeTransfer(
        address from,
        address to,
        uint256 vaultID,
        bytes memory _data
    ) internal {
        _transfer(from, to, vaultID);
        require(_checkOnERC721Received(from, to, vaultID, _data), "29");
    }

    /// @notice Checks whether a vault exists
    /// @param vaultID ID of the vault to check
    /// @return Whether `vaultID` has been created
    function _exists(uint256 vaultID) internal view returns (bool) {
        return _owners[vaultID] != address(0);
    }

    /// @notice Internal version of the `isApprovedOrOwner` function
    function _isApprovedOrOwner(address spender, uint256 vaultID) internal view returns (bool) {
        // The following checks if the vault exists
        address owner = _ownerOf(vaultID);
        return (spender == owner || _getApproved(vaultID) == spender || _operatorApprovals[owner][spender]);
    }

    /// @notice Internal version of the `createVault` function
    /// Mints `vaultID` and transfers it to `to`
    /// @dev This method is equivalent to the `_safeMint` method used in OpenZeppelin ERC721 contract
    /// @dev Emits a {Transfer} event
    function _mint(address to) internal returns (uint256 vaultID) {
        require(!whitelistingActivated || (isWhitelisted[to] && isWhitelisted[msg.sender]), "20");
        _vaultIDCount.increment();
        vaultID = _vaultIDCount.current();
        _balances[to] += 1;
        _owners[vaultID] = to;
        emit Transfer(address(0), to, vaultID);
        require(_checkOnERC721Received(address(0), to, vaultID, ""), "29");
    }

    /// @notice Destroys `vaultID`
    /// @dev `vaultID` must exist
    /// @dev Emits a {Transfer} event
    function _burn(uint256 vaultID) internal {
        address owner = _ownerOf(vaultID);

        // Clear approvals
        _approve(address(0), vaultID);

        _balances[owner] -= 1;
        delete _owners[vaultID];
        delete vaultData[vaultID];

        emit Transfer(owner, address(0), vaultID);
    }

    /// @notice Transfers `vaultID` from `from` to `to` as opposed to {transferFrom},
    /// this imposes no restrictions on msg.sender
    /// @dev `to` cannot be the zero address and `perpetualID` must be owned by `from`
    /// @dev Emits a {Transfer} event
    /// @dev A whitelist check is performed if necessary on the `to` address
    function _transfer(
        address from,
        address to,
        uint256 vaultID
    ) internal {
        require(_ownerOf(vaultID) == from, "30");
        require(to != address(0), "31");
        require(!whitelistingActivated || isWhitelisted[to], "20");
        // Clear approvals from the previous owner
        _approve(address(0), vaultID);

        _balances[from] -= 1;
        _balances[to] += 1;
        _owners[vaultID] = to;

        emit Transfer(from, to, vaultID);
    }

    /// @notice Approves `to` to operate on `vaultID`
    function _approve(address to, uint256 vaultID) internal {
        _vaultApprovals[vaultID] = to;
        emit Approval(_ownerOf(vaultID), to, vaultID);
    }

    /// @notice Internal function to invoke {IERC721Receiver-onERC721Received} on a target address
    /// The call is not executed if the target address is not a contract
    /// @param from Address representing the previous owner of the given token ID
    /// @param to Target address that will receive the tokens
    /// @param vaultID ID of the token to be transferred
    /// @param _data Bytes optional data to send along with the call
    /// @return Bool whether the call correctly returned the expected value
    function _checkOnERC721Received(
        address from,
        address to,
        uint256 vaultID,
        bytes memory _data
    ) private returns (bool) {
        if (to.isContract()) {
            try IERC721ReceiverUpgradeable(to).onERC721Received(msg.sender, from, vaultID, _data) returns (
                bytes4 retval
            ) {
                return retval == IERC721ReceiverUpgradeable(to).onERC721Received.selector;
            } catch (bytes memory reason) {
                if (reason.length == 0) {
                    revert("24");
                } else {
                    // solhint-disable-next-line no-inline-assembly
                    assembly {
                        revert(add(32, reason), mload(reason))
                    }
                }
            }
        } else {
            return true;
        }
    }
}
