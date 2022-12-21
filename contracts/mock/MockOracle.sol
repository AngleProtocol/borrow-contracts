// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.7;

import "../interfaces/IOracle.sol";

contract MockOracle is IOracle {
    event Update(uint256 _peg);

    ITreasury public treasury;

    uint256 public base = 1 ether;
    uint256 public precision = 1 ether;
    uint256 public rate;
    bool public outdated;

    /// @notice Initiate with a fixe change rate
    constructor(uint256 rate_, ITreasury _treasury) {
        rate = rate_;
        treasury = _treasury;
    }

    /// @notice Mock read
    function read() external view override returns (uint256) {
        return rate;
    }

    /// @notice change oracle rate
    function update(uint256 newRate) external {
        rate = newRate;
    }

    function setTreasury(address _treasury) external override {
        treasury = ITreasury(_treasury);
    }

    function circuitChainlink() external pure override returns (AggregatorV3Interface[] memory) {}
}
