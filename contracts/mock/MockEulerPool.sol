// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockEulerPool {
    IERC20 public collateral;
    uint256 public poolSize;

    mapping(address => uint256) public users;
    uint256 public interestRateAccumulator;

    constructor(IERC20 collateral_, uint256 poolSize_) {
        collateral = collateral_;
        poolSize = poolSize_;
        interestRateAccumulator = 10**18;
    }

    function setPoolSize(uint256 poolSize_) external {
        uint256 balance = collateral.balanceOf(address(this));
        poolSize = poolSize_;
        if (balance > poolSize_) collateral.transfer(msg.sender, balance - poolSize_);
        if (balance < poolSize_) collateral.transferFrom(msg.sender, address(this), poolSize_ - balance);
    }

    function setInterestRateAccumulator(uint256 interestRateAccumulator_) external {
        interestRateAccumulator = interestRateAccumulator_;
    }

    function balanceOfUnderlying(address account) external view returns (uint256) {
        return (users[account] * interestRateAccumulator) / 10**18;
    }

    function deposit(uint256, uint256 amount) external {
        users[msg.sender] += (amount * 10**18) / interestRateAccumulator;
        poolSize += amount;
        collateral.transferFrom(msg.sender, address(this), amount);
    }

    function withdraw(uint256, uint256 amount) external {
        if (amount == type(uint256).max) amount = (users[msg.sender] * interestRateAccumulator) / 10**18;

        require(amount <= poolSize, "4");
        users[msg.sender] -= (amount * 10**18) / interestRateAccumulator;
        collateral.transfer(msg.sender, amount);
    }
}
