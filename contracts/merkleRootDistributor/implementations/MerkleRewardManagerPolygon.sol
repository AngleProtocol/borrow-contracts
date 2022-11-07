// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

import "../MerkleRewardManager.sol";

/// @title MerkleRewardManagerPolygon
/// @author Angle Labs, Inc.
/// @notice Polygon implementation of the MerkleRewardManager contract
contract MerkleRewardManagerPolygon is MerkleRewardManager {
    /// @notice Returns the agEUR address on the corresponding chain
    function _agEUR() internal pure override returns (address) {
        return 0xE0B52e49357Fd4DAf2c15e02058DCE6BC0057db4;
    }
}
