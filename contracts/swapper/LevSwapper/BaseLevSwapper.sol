// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.12;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../../interfaces/IAngleRouterSidechain.sol";
import "../../interfaces/ICoreBorrow.sol";
import "../../interfaces/IBorrowStaker.sol";
import "../../interfaces/external/uniswap/IUniswapRouter.sol";

import "../SwapperSidechain.sol";

/// @title BaseLevSwapper
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

    /// @notice Implements the bundle transaction to increase/decrease exposure to a token
    /// and then stake the token into `angleStaker` contract in the leverage case
    /// @param amount Amount sent to the contract before any other actions
    /// @param data Encoded data giving specific instruction to the bundle tx
    /// @dev The amountOut is unused so let it as 0
    /// @dev All token transfers must have been done beforehand
    /// @dev This function can support multiple swaps to get a desired token
    function _swapLeverage(uint256 amount, bytes memory data) internal override returns (uint256 amountOut) {
        bool leverage;
        address to;
        bytes[] memory oneInchPayloads;
        (leverage, to, data) = abi.decode(data, (bool, address, bytes));
        if (leverage) {
            (oneInchPayloads, data) = abi.decode(data, (bytes[], bytes));
            // After sending all your tokens you have the possibility to swap them through 1inch
            // For instance when borrowing on Angle you receive agEUR, but may want to be LP on
            // the 3Pool, you can then swap 1/3 of the agEUR to USDC, 1/3 to USDT and 1/3 to DAI
            // before providing liquidity
            // These swaps are easy to anticipate as you know how many tokens have been sent when querying the 1inch API
            _multiSwap1inch(oneInchPayloads);
            amountOut = _add(data);
            angleStaker().deposit(amountOut, to);
        } else {
            IERC20[] memory sweepTokens;
            (sweepTokens, oneInchPayloads, data) = abi.decode(data, (IERC20[], bytes[], bytes));
            // Should transfer the token to the contract this will claim the rewards for the current owner of the wrapper
            angleStaker().withdraw(amount, address(this), address(this));
            _remove(amount, data);
            // Taking the same example as in the `leverage` side, you can withdraw USDC, DAI and USDT while wanting to
            // to repay a debt in agEUR so you need to do a multiswap.
            // These swaps are not easy to anticipate the amounts received depend on the deleverage action which can be chaotic
            // Very often, it's better to swap a lower bound and then sweep the tokens, even though it's not the most efficient
            // thing to do
            _multiSwap1inch(oneInchPayloads);
            // After the swaps and/or the deleverage we can end up with useless tokens for repaying a debt and therefore let the
            // possibility to send it wherever
            _sweep(sweepTokens, to);
        }
    }

    /// @notice Allows to do an arbitrary number of swaps using 1inch API
    /// @param data Encoded info to execute the swaps from `_swapOn1Inch`
    function _multiSwap1inch(bytes[] memory data) internal {
        for (uint256 i = 0; i < data.length; i++) {
            (address inToken, uint256 minAmount, bytes memory payload) = abi.decode(data[i], (address, uint256, bytes));
            uint256 amountOut = _swapOn1Inch(IERC20(inToken), payload);
            // we check the slippage in this case as `swap()`will only check it for the `outToken`
            if (amountOut < minAmount) revert TooSmallAmountOut();
        }
    }

    /// @notice Sweeps tokens from the contract
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

    /// @notice Token used as collateral on the borrow module, which wraps the `true` collateral
    function angleStaker() public view virtual returns (IBorrowStaker);

    // ========================= INTERNAL VIRTUAL FUNCTIONS ========================

    /// @notice Implements the bundle transaction to increase exposure to a token
    /// @param data Encoded data giving specific instruction to the bundle tx
    function _add(bytes memory data) internal virtual returns (uint256 amountOut);

    /// @notice Implements the bundle transaction to decrease exposure to a token
    /// @param toUnstake Amount of tokens to withdraw from the `angleStaker`
    /// @param data Encoded data giving specific instruction to the bundle tx
    function _remove(uint256 toUnstake, bytes memory data) internal virtual returns (uint256 amount);
}
