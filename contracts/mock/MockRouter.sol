// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../interfaces/IAngleRouter.sol";
import "../interfaces/external/uniswap/IUniswapRouter.sol";
import "../interfaces/external/lido/IWStETH.sol";

contract MockRouter is IAngleRouter, IUniswapV3Router, IWStETH {
    using SafeERC20 for IERC20;

    uint256 public counter;
    uint256 public amountOutUni;
    uint256 public multiplierMintBurn;

    address public stETH;

    constructor() {}

    function mint(
        address user,
        uint256 amount,
        uint256 minStableAmount,
        address stablecoin,
        address collateral
    ) external {
        counter += 1;
        IERC20(collateral).safeTransferFrom(msg.sender, address(this), amount);
        IERC20(stablecoin).safeTransfer(user, minStableAmount * 10**9/multiplierMintBurn);
    }

    function burn(
        address user,
        uint256 amount,
        uint256 minAmountOut,
        address stablecoin,
        address collateral
    ) external {
        counter += 1;
        IERC20(stablecoin).safeTransferFrom(msg.sender, address(this),amount);
        IERC20(collateral).safeTransfer(user, minAmountOut*multiplierMintBurn/10**9);
    }

    function wrap(uint256 amount) external returns (uint256){
        IERC20(stETH).safeTransferFrom(msg.sender, address(this), amount);
        return(amount);
    }

    function oneInch() external {
        counter+=1;
    }

    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut) {
        counter += 1;
        return params.amountIn * amountOutUni/10**9;
    }

    function setMultipliers(uint256 a, uint256 b) external {
        amountOutUni = a;
        multiplierMintBurn = b;
    }

}
