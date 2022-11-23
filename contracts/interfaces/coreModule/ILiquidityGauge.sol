// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

interface ILiquidityGauge {
    function deposit(
        uint256 _value,
        address _addr,
        // solhint-disable-next-line
        bool _claim_rewards
    ) external;

    function withdraw(
        uint256 _value,
        // solhint-disable-next-line
        bool _claim_rewards
    ) external;

    // solhint-disable-next-line
    function claim_rewards(address _addr, address _receiver) external;

    // solhint-disable-next-line
    function claimable_reward(address _addr, address _reward_token) external view returns (uint256 amount);
}
