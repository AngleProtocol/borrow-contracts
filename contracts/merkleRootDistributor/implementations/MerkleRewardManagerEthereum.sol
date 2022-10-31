// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

import "../MerkleRewardManager.sol";

/// @title MerkleRewardManagerEthereum
/// @author Angle Labs, Inc.
/// @notice Ethereum implementation of the MerkleRewardManager contract
contract MerkleRewardManagerEthereum is MerkleRewardManager {
    /// @notice Returns the agEUR address on the corresponding chain
    function _agEUR() internal pure override returns (address) {
        return 0x1a7e4e63778B4f12a199C062f3eFdD288afCBce8;
    }
}
