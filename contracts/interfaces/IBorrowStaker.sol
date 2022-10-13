// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.7;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IBorrowStaker is IERC20 {
    function stakingToken() external returns (address stakingToken);

    function depositRewardToken(address _rewardToken, uint256 _amount) external;

    function deposit(uint256 amount, address to) external;

    function withdraw(
        uint256 amount,
        address from,
        address to
    ) external;

    function claimRewards(address user) external;
}
