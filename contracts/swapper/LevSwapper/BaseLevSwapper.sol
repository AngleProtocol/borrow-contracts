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
/// @notice Swapper contract facilitating interactions with a `VaultManager` - liquidation, leverage, wrapping and unwrapping
abstract contract BaseLevSwapper is SwapperSidechain {
    using SafeERC20 for IERC20;

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

    /// @notice Implementing the bundle transaction to increase/decrease exposure to a token
    /// and then stake the token into `angleStaker` contract in the leverage case
    /// @param data Encoded data giving specific instruction to the bundle tx
    /// @return amountOut Amount obtained from the swap.
    /// TODO This can be misleading as in some cases the swap can result in multiple tokens.
    /// Also this ariable is not used, so worth removing the return value
    /// @dev All transfers must have been done before hand
    function _swapLeverage(bytes memory data) internal override returns (uint256 amountOut) {
        bool leverage;
        address to;
        bytes[] memory oneInchPayloads;
        (leverage, to, data) = abi.decode(data, (bool, address, bytes));
        if (leverage) {
            (oneInchPayloads, data) = abi.decode(data, (bytes[], bytes));
            // After sending all your tokens you have the possibility to swap them through 1inch
            // For instance when borrowing on Angle you receive agEUR, but may want to be LP on
            // the 3Pool, tou can then swap 1/3 of the agEUR to USDC, 1/3 to USDT and 1/3 to DAI
            // before providing liquidity
            // These swaps are easy to anticipate as you know how many tokens have been sent when querying the 1inch API
            _multiSwap1inch(oneInchPayloads);
            amountOut = _add(data);
            angleStaker().deposit(amountOut, to);
        } else {
            uint256 toUnstake;
            IERC20 outToken;
            IERC20[] memory sweepTokens;
            (toUnstake, outToken, sweepTokens, oneInchPayloads, data) = abi.decode(
                data,
                (uint256, IERC20, IERC20[], bytes[], bytes)
            );
            // should transfer the token to the contract this will claim the rewards for the current owner of the wrapper
            angleStaker().withdraw(toUnstake, address(this), address(this));
            _remove(toUnstake, data);
            // Taking the same example as in the `leverage` side, you can withdraw USDC,DAI and USDT while wanting to
            // to repay a debt in agEUR so you need to do a multiswap
            // These swaps are not easy to anticipate the amounts received depends on the deleverage action which can be chaotic
            // Better to swap a lower bound and then sweep the tokens --> loss of efficiency
            _multiSwap1inch(oneInchPayloads);
            // after the swaps and/or the delevrage we can end up with useless tokens for repaying a debt and therefore let the
            // possibility to send it wherever
            _sweep(sweepTokens, to);
            // TODO not useful actually to send an amountOut and quering the balance is expensive
            amountOut = outToken.balanceOf(address(this));
        }
    }

    /// @notice Allows to do an arbitrary number of swaps using 1Inch API
    /// @param data Encoded info to exceute the swaps from `_swapOn1Inch`
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

    // ========================= EXTERNAL VIRTUAL FUNCTIONS ========================

    /// @notice Token used as collateral on the borrow module, which wrap the `true` collateral
    function angleStaker() public pure virtual returns (IBorrowStaker);

    // ========================= INTERNAL VIRTUAL FUNCTIONS ========================

    /// @notice Implementing the bundle transaction to increase exposure to a token
    /// @param data Encoded data giving specific instruction to the bundle tx
    function _add(bytes memory data) internal virtual returns (uint256 amountOut);

    /// @notice Implementing the bundle transaction to decrease exposure to a token
    /// @param toUnstake Amount of tokens to withdraw from the `angleStaker`
    /// @param data Encoded data giving specific instruction to the bundle tx
    function _remove(uint256 toUnstake, bytes memory data) internal virtual returns (uint256 amount);
}
