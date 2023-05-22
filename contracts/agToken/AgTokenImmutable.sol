// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.17;

import "./AgToken.sol";

/// @title AgTokenImmutable
/// @author Angle Labs, Inc.
/// @notice Contract for immutable Angle's stablecoins
contract AgTokenImmutable is AgToken {
    constructor(string memory name_, string memory symbol_, address _treasury) AgToken() initializer {
        _initializeBase(name_, symbol_, _treasury);
    }

    /// @inheritdoc BaseAgToken
    function _initialize(string memory name_, string memory symbol_, address _treasury) internal override {}
}
