// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.12;

import { ILiquidityGauge } from "../interfaces/coreModule/ILiquidityGauge.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockLiquidityGauge is ILiquidityGauge, ERC20 {
    using SafeERC20 for IERC20;

    IERC20 internal _ANGLE = IERC20(0x31429d1856aD1377A8A0079410B297e1a9e214c2);
    IERC20 internal _token;
    mapping(address => uint256) public rewards;

    constructor(
        string memory name_,
        string memory symbol_,
        address token_
    ) ERC20(name_, symbol_) {
        _token = IERC20(token_);
    }

    function deposit(
        uint256 _value,
        address _addr,
        // solhint-disable-next-line
        bool
    ) external {
        _token.safeTransferFrom(msg.sender, address(this), _value);
        _mint(_addr, _value);
    }

    function withdraw(
        uint256 _value,
        // solhint-disable-next-line
        bool
    ) external {
        _burn(msg.sender, _value);
        _token.safeTransfer(msg.sender, _value);
    }

    // solhint-disable-next-line
    function claim_rewards(address _addr, address _receiver) external {
        if (_receiver == address(0)) _receiver = _addr;
        _ANGLE.safeTransfer(_receiver, rewards[_addr]);
        rewards[_addr] = 0;
    }

    // solhint-disable-next-line
    function claimable_reward(address _addr, address) external view returns (uint256 amount) {
        return rewards[_addr];
    }

    function setReward(address receiver_, uint256 amount) external {
        rewards[receiver_] = amount;
    }
}
