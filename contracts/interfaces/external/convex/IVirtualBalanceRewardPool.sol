// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

interface IVirtualBalanceRewardPool {
    function balanceOf(address account) external view returns (uint256);

    function currentRewards() external view returns (uint256);

    function deposits() external view returns (address);

    function duration() external view returns (uint256);

    function earned(address account) external view returns (uint256);

    function getReward() external;

    function getReward(address _account) external;

    function lastTimeRewardApplicable() external view returns (uint256);

    function lastUpdateTime() external view returns (uint256);

    function operator() external view returns (address);

    function periodFinish() external view returns (uint256);

    function rewardRate() external view returns (uint256);

    function rewardToken() external view returns (address);

    function rewards(address) external view returns (uint256);

    function stake(address _account, uint256 amount) external;

    function totalSupply() external view returns (uint256);

    function withdraw(address _account, uint256 amount) external;
}
