// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.12;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../../interfaces/IAngleRouterSidechain.sol";
import "../../interfaces/ICoreBorrow.sol";
import "../../interfaces/IBorrowStaker.sol";
import "../../interfaces/external/uniswap/IUniswapRouter.sol";

import "../SwapperSidechain.sol";

/// @param token Token address
/// @param amount Amount of token owned
struct SwapType {
    IERC20 token;
    uint256 amount;
}

/// @title SwapperSidechain
/// @author Angle Core Team
/// @notice Swapper contract facilitating interactions with the VaultManager: to liquidate and get leverage
abstract contract BaseLevSwapper is SwapperSidechain {
    using SafeERC20 for IERC20;

    // ================================= CONSTANTS =================================

    /// @notice Token used as collateral on the borrow module, which wrap the `true`collateral
    IBorrowStaker public constant ANGLE_STAKER = IBorrowStaker(address(0));

    /// @notice Constructor of the contract
    /// @param _core Core address
    /// @param _uniV3Router UniswapV3 Router address
    /// @param _oneInch 1Inch Router address
    /// @param _angleRouter AngleRouter contract address
    constructor(
        ICoreBorrow _core,
        IUniswapV3Router _uniV3Router,
        address _oneInch,
        IAngleRouterSidechain _angleRouter
    ) SwapperSidechain(_core, _uniV3Router, _oneInch, _angleRouter) {}

    // ============================= INTERNAL FUNCTIONS ============================

    /// @dev All transfers must have been done before hand
    function _swapLeverage(bytes memory data) internal override returns (uint256 amountOut) {
        bool leverage;
        address to;
        bytes[] memory oneInchPayloads;
        (leverage, to, data) = abi.decode(data, (bool, address, bytes));
        if (leverage) {
            (oneInchPayloads, data) = abi.decode(data, (bytes[], bytes));
            _multiSwap1inch(oneInchPayloads);
            amountOut = _leverage(data);
            ANGLE_STAKER.deposit(amountOut, to);
        } else {
            uint256 toUnstake;
            IERC20 outToken;
            IERC20[] memory sweepTokens;
            (toUnstake, outToken, sweepTokens, oneInchPayloads, data) = abi.decode(
                data,
                (uint256, IERC20, IERC20[], bytes[], bytes)
            );
            // should transfer the token to the contract this will claim the rewards for the current owner of the wrapper
            ANGLE_STAKER.withdraw(toUnstake, address(this), address(this));
            _deleverage(toUnstake, data);
            _multiSwap1inch(oneInchPayloads);
            // after the swaps and/or the delevrage we can end up with unusefull tokens for repaying a debt and therefore le the
            // possibility to send it wherever
            _sweep(sweepTokens, to);
            // TODO not useful actually to send an amountOut and quering the balance is expensive
            amountOut = outToken.balanceOf(address(this));
        }
    }

    function _multiSwap1inch(bytes[] memory data) internal {
        for (uint256 i = 0; i < data.length; i++) {
            (address inToken, bytes memory payload) = abi.decode(data[i], (address, bytes));
            _swapOn1Inch(IERC20(inToken), payload);
        }
    }

    /// @notice Sweeps tokens from the router contract
    /// @param tokensOut Token to sweep
    /// @param to Address to which tokens should be sent
    function _sweep(IERC20[] memory tokensOut, address to) internal {
        for (uint256 i = 0; i < tokensOut.length; i++) {
            uint256 balanceToken = tokensOut[i].balanceOf(address(this));
            if (balanceToken > 0) {
                tokensOut[i].safeTransfer(to, balanceToken);
            }
        }
    }

    // ========================= INTERNAL VIRTUAL FUNCTIONS ========================

    function _leverage(bytes memory data) internal virtual returns (uint256 amountOut);

    function _deleverage(uint256 toUnstake, bytes memory data) internal virtual returns (uint256 amount);
}
