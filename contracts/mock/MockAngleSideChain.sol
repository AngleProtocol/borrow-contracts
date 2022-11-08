// SPDX-License-Identifier: AGPL-3.0-only

pragma solidity 0.8.12;

import "../bridgeERC20/AngleSideChainMultiBridge.sol";

/// @title MockAngleSideChain
/// @author Angle Core Team
contract MockAngleSideChain is AngleSideChainMultiBridge {
    function mint(address account, uint256 amount) external {
        _mint(account, amount);
    }
}
