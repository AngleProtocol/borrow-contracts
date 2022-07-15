// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../interfaces/ITreasury.sol";

struct MerkleTree {
    // Root of merkle tree whose leaves are (address user, address token, uint amount)
    // representing and amount of token owed to user
    // The Merkle tree is assumed to have only increasing amounts
    // that is to say if a user can claim 1, after the next update he should be able to claim x > 1.
    bytes32 merkleRoot;
    // ipfs hash of the tree data
    bytes32 ipfsHash;
}

/// @title MerkleRootDistributor
/// @notice Allows the DAO to distribute rewards through Merkle Roots.
/// @author Angle Core Team
contract MerkleRootDistributor is Initializable {
    using SafeERC20 for IERC20;

    /// @notice Tree of claimable tokens through this contract
    MerkleTree public tree;

    /// @notice Treasury contract handling access control
    ITreasury public treasury;

    // Mapping user -> token -> amount to track claimed amounts
    mapping(address => mapping(address => uint256)) public claimed;

    // Trusted EOA to update the merkle root
    mapping(address => uint256) public trusted;

    uint256[46] private __gap;

    // ================================== Events ===================================

    event TrustedToggled(address indexed eao, bool trust);
    event Recovered(address indexed token, address indexed to, uint256 amount);
    event TreeUpdated(bytes32 merkleRoot, bytes32 ipfsHash);
    event Claimed(address user, address token, uint256 amount);

    // ================================== Errors ===================================

    error NotGovernorOrGuardian();
    error NotTrusted();
    error InvalidLengths();
    error InvalidProof();

    // ================================= Modifiers =================================

    /// @notice Checks whether the `msg.sender` has the governor role or the guardian role
    modifier onlyGovernorOrGuardian() {
        if (!treasury.isGovernorOrGuardian(msg.sender)) revert NotGovernorOrGuardian();
        _;
    }

    /// @notice Checks whether the `msg.sender` has the governor role or the guardian role
    modifier onlyTrusted() {
        if (!treasury.isGovernorOrGuardian(msg.sender) && trusted[msg.sender] != 1) revert NotGovernorOrGuardian();
        _;
    }

    // ============================ Constructor ====================================

    constructor() initializer {}

    function initialize(ITreasury _treasury) public initializer {
        treasury = _treasury;
    }

    // =========================== Main Function ===================================

    /// @notice Claim rewards for a given user
    /// @dev Anyone may call this function for anyone else, funds go to destination regardless, it's just a question of
    /// @dev who provides the proof and pays the gas, msg.sender is not used in this function
    /// @param users recipient of tokens
    /// @param tokens ERC20 claimed
    /// @param amounts amount of tokens that will be sent to `user`
    /// @param proofs array of hashes bridging from leaf (hash of user | token | amount) to merkle root
    function claim(
        address[] calldata users,
        address[] calldata tokens,
        uint256[] calldata amounts,
        bytes32[][] calldata proofs
    ) public {
        if (
            users.length == 0 ||
            users.length != tokens.length ||
            users.length != amounts.length ||
            users.length != proofs.length
        ) revert InvalidLengths();

        for (uint256 i = 0; i < users.length; i++) {
            address user = users[i];
            address token = tokens[i];
            uint256 amount = amounts[i];

            // Verifying proof
            bytes32 leaf = keccak256(abi.encode(user, token, amount));
            if (!_verifyProof(leaf, proofs[i])) revert InvalidProof();

            // Closing reentrancy gate here
            uint256 toSend = amount - claimed[user][token];
            claimed[user][token] = amount;

            IERC20(token).safeTransfer(user, toSend);
            emit Claimed(user, token, toSend);
        }
    }

    // =========================== Governance Functions ===============================

    /// @notice Adds or removes trusted EOA
    function toggleTrusted(address eoa) external onlyGovernorOrGuardian {
        trusted[eoa] = 1 - trusted[eoa];
        emit TrustedToggled(eoa, trusted[eoa] == 1);
    }

    /// @notice Updates Merkle Tree
    function updateTree(MerkleTree calldata _tree) external onlyTrusted {
        tree = _tree;
        emit TreeUpdated(tree.merkleRoot, tree.ipfsHash);
    }

    /// @notice Recovers any ERC20 token
    function recoverERC20(
        address tokenAddress,
        address to,
        uint256 amountToRecover
    ) external onlyGovernorOrGuardian {
        IERC20(tokenAddress).safeTransfer(to, amountToRecover);
        emit Recovered(tokenAddress, to, amountToRecover);
    }

    // =========================== Internal Functions ===============================

    /// @notice Checks the validity of a proof
    /// @param leaf Hashed leaf data, the starting point of the proof
    /// @param proof Array of hashes forming a hash chain from leaf to root
    /// @return true if proof is correct, else false
    function _verifyProof(bytes32 leaf, bytes32[] memory proof) internal view returns (bool) {
        bytes32 currentHash = leaf;
        for (uint256 i = 0; i < proof.length; i += 1) {
            if (currentHash < proof[i]) {
                currentHash = keccak256(abi.encode(currentHash, proof[i]));
            } else {
                currentHash = keccak256(abi.encode(proof[i], currentHash));
            }
        }
        return currentHash == tree.merkleRoot;
    }
}
