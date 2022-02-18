// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.10;

import "../interfaces/IFlashAngle.sol";
import "../interfaces/ICoreBorrow.sol";

contract MockFlashLoanModule is IFlashAngle {
    ICoreBorrow public override core;
    mapping(address => bool) public stablecoinsSupported;
    mapping(IAgToken => uint256) public interestAccrued;

    constructor(ICoreBorrow _core) {
        core = _core;
    }

    function accrueInterestToTreasury(IAgToken stablecoin) external override returns (uint256 balance) {
        interestAccrued[stablecoin] += balance;
    }

    function addStablecoinSupport(address _treasury) external override {
        stablecoinsSupported[_treasury] = true;
    }

    function removeStablecoinSupport(address _treasury) external override {
        stablecoinsSupported[_treasury] = false;
    }

    function setCore(address _core) external override {
        core = ICoreBorrow(_core);
    }
}
