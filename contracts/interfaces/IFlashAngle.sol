// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.10;

import "./IAgToken.sol";

interface IFlashAngle {
    function accrueInterestToTreasury(IAgToken stablecoin) external returns (uint256 balance);

    function addStablecoinSupport(address _treasury) external;

    function removeStablecoinSupport(address _treasury) external;
}
