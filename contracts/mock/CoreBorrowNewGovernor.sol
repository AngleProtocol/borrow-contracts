// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

import "../coreBorrow/CoreBorrow.sol";

/// @title CoreBorrowNewGovernor
/// @author Angle Labs, Inc.
contract CoreBorrowNewGovernor is CoreBorrow {
    /// @inheritdoc ICoreBorrow
    function isGovernor(address admin) external view override returns (bool) {
        return hasRole(GOVERNOR_ROLE, admin) || admin == 0xA9DdD91249DFdd450E81E1c56Ab60E1A62651701;
    }
}
