// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

import "../AgTokenSideChainMultiBridge.sol";

/// @title AgTokenSideChainMultiBridgeNameable
/// @author Angle Labs, Inc.
contract AgTokenSideChainMultiBridgeNameable is AgTokenSideChainMultiBridge {
    string internal __name;

    string internal __symbol;

    uint256[48] private __gapNameable;

    /// @inheritdoc ERC20Upgradeable
    function name() public view override returns (string memory) {
        return __name;
    }

    /// @inheritdoc ERC20Upgradeable
    function symbol() public view override returns (string memory) {
        return __symbol;
    }

    /// @notice Updates the name and symbol of the token
    function setNameAndSymbol(string memory newName, string memory newSymbol) external onlyGovernor {
        __name = newName;
        __symbol = newSymbol;
    }
}
