// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockEulerPool {
    IERC20 public collateral;
    uint256 public poolSize;

    constructor(IERC20 collateral_, uint256 poolSize_) {
        collateral = collateral_;
        poolSize = poolSize_;
    }

    function setPoolSize(uint256 poolSize_) external {
        poolSize = poolSize_;
    }

    function deposit(uint256, uint256 amount) external {
        collateral.transferFrom(msg.sender, address(this), amount);
    }

    function withdraw(uint256, uint256 amount) external {
        require(amount <= poolSize, "4");
        collateral.transferFrom(address(this), msg.sender, amount);
    }
}
