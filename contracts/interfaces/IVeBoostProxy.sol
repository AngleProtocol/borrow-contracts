// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.10;

interface IVeBoostProxy {
    /// @notice Reads the adjusted veANGLE balance of an address (adjusted by delegation)
    //solhint-disable-next-line
    function adjusted_balance_of(address) external view returns (uint256);
}
