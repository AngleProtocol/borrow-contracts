// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

import "../polygon/TokenPolygonUpgradeable.sol";

/// @title TokenPolygonUpgradeableNameable
/// @author Angle Labs, Inc.
contract TokenPolygonUpgradeableNameable is TokenPolygonUpgradeable {
    string internal __name;

    string internal __symbol;

    uint256[48] private __gapNameable;

    /// @inheritdoc ERC20UpgradeableCustom
    function name() public view override returns (string memory) {
        return __name;
    }

    /// @inheritdoc ERC20UpgradeableCustom
    function symbol() public view override returns (string memory) {
        return __symbol;
    }

    /// @notice Updates the name and symbol of the token
    function setNameAndSymbol(string memory newName, string memory newSymbol) external onlyGovernor {
        __name = newName;
        __symbol = newSymbol;
    }
}
