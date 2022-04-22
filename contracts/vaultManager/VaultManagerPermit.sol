// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

import "@openzeppelin/contracts-upgradeable/utils/cryptography/draft-EIP712Upgradeable.sol";

import "./VaultManagerERC721.sol";

/// @title VaultManagerPermit
/// @author Angle Core Team
/// @dev Base Implementation of permit functions for the `VaultManager` contract
abstract contract VaultManagerPermit is Initializable, VaultManagerERC721, EIP712Upgradeable {
    mapping(address => uint256) private _nonces;
    bytes32 private _PERMIT_FOR_ALL_TYPEHASH =
        keccak256("Permit(address owner,address spender,bool approved,uint256 nonce,uint256 deadline)");
    bytes32 private _PERMIT_TYPEHASH =
        keccak256("Permit(address spender,uint256 tokenID,uint256 nonce,uint256 deadline)");

    error ExpiredDeadline();
    error InvalidSignature();

    function __ERC721Permit_init(string memory name) internal onlyInitializing {
        __EIP712_init_unchained(name, "1");
    }

    function permitForAll(
        address owner,
        address spender,
        bool approved,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public virtual {
        if (block.timestamp > deadline) revert ExpiredDeadline();
        bytes32 structHash = keccak256(
            abi.encode(_PERMIT_FOR_ALL_TYPEHASH, owner, spender, approved, _useNonce(owner), deadline)
        );
        _structHashCheck(structHash, v, r, s, owner);
        _setApprovalForAll(owner, spender, approved);
    }

    function permit(
        address spender,
        uint256 tokenID,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public virtual {
        if (block.timestamp > deadline) revert ExpiredDeadline();
        address owner = _ownerOf(tokenID);

        bytes32 structHash = keccak256(abi.encode(_PERMIT_TYPEHASH, spender, tokenID, _useNonce(owner), deadline));
        _structHashCheck(structHash, v, r, s, owner);
        _approve(spender, tokenID);
    }

    function _structHashCheck(
        bytes32 structHash,
        uint8 v,
        bytes32 r,
        bytes32 s,
        address owner
    ) internal view {
        bytes32 hash = _hashTypedDataV4(structHash);
        address signer = ECDSAUpgradeable.recover(hash, v, r, s);
        if (signer != owner) revert InvalidSignature();
    }

    /**
     * @dev See {IERC20Permit-nonces}.
     */
    function nonces(address owner) public view virtual returns (uint256) {
        return _nonces[owner];
    }

    /**
     * @dev See {IERC20Permit-DOMAIN_SEPARATOR}.
     */
    // solhint-disable-next-line func-name-mixedcase
    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /**
     * @dev "Consume a nonce": return the current value and increment.
     *
     * _Available since v4.1._
     */
    function _useNonce(address owner) internal virtual returns (uint256 current) {
        current = _nonces[owner];
        _nonces[owner] = current + 1;
    }

    uint256[49] private __gap;
}
