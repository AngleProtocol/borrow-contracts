// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.17;

import "./AgToken.sol";

/// @title AgTokenImmutable
/// @author Angle Labs, Inc.
/// @notice Contract for immutable Angle's stablecoins
<<<<<<< HEAD:contracts/agToken/AgTokenSideChainImmutable.sol
contract AgTokenSideChainImmutable is AgTokenSideChain {
    constructor(string memory name_, string memory symbol_, address _treasury) AgTokenSideChain() initializer {
=======
contract AgTokenImmutable is AgToken {
    constructor(string memory name_, string memory symbol_, address _treasury) AgToken() initializer {
>>>>>>> bc13911 (fixing agToken names and stuff):contracts/agToken/AgTokenImmutable.sol
        _initializeBase(name_, symbol_, _treasury);
    }

    /// @inheritdoc BaseAgToken
    function _initialize(string memory name_, string memory symbol_, address _treasury) internal override {}
}
