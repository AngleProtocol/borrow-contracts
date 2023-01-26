// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.17;

import "./AgTokenSideChain.sol";

/// @title AgTokenImmutable
/// @author Angle Labs, Inc.
/// @notice Contract for immutable Angle's stablecoins
contract AgTokenSideChainImmutable is AgTokenSideChain {
    /// @param name_ Name of the token
    /// @param symbol_ Symbol of the token
    /// @param _treasury Reference to the `Treasury` contract associated to this agToken implementation
    /// @dev As `AgTokenSideChain` constructor is called by inheritance it will invalidate the `initialize` function
    /// @dev By default, agTokens are ERC-20 tokens with 18 decimals
    constructor(
        string memory name_,
        string memory symbol_,
        address _treasury
    ) AgTokenSideChain() {
        __ERC20Permit_init(name_);
        __ERC20_init(name_, symbol_);
        if (address(ITreasury(_treasury).stablecoin()) != address(this)) revert InvalidTreasury();
        treasury = _treasury;
        emit TreasuryUpdated(address(_treasury));
    }

    /// @inheritdoc BaseAgTokenSideChain
    function setTreasury(address _treasury) external override {}
}
