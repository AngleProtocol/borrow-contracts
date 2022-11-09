// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.12;

import "../BaseLevSwapper.sol";
import "../../../interfaces/external/curve/IMetaPool2.sol";

/// @notice All possible removals on Curve
enum CurveRemovalType {
    oneCoin,
    balance,
    imbalance,
    none
}

/// @title CurveLevSwapper2Tokens
/// @author Angle Core Team
/// @dev Leverage swapper on Curve LP tokens
/// @dev This implementation is for Curve pools with 2 tokens
abstract contract CurveLevSwapper2Tokens is BaseLevSwapper {
    using SafeERC20 for IERC20;

    constructor(
        ICoreBorrow _core,
        IUniswapV3Router _uniV3Router,
        address _oneInch,
        IAngleRouterSidechain _angleRouter
    ) BaseLevSwapper(_core, _uniV3Router, _oneInch, _angleRouter) {}

    // =============================== MAIN FUNCTIONS ==============================

    /// @inheritdoc BaseLevSwapper
    function _add(bytes memory) internal override returns (uint256 amountOut) {
        // Instead of doing sweeps at the end just use the full balance to add liquidity
        uint256 amountToken1 = token1().balanceOf(address(this));
        uint256 amountToken2 = token2().balanceOf(address(this));
        // Slippage is checked at the very end of the `swap` function
        if (amountToken1 > 0 || amountToken2 > 0) metapool().add_liquidity([amountToken1, amountToken2], 0);
        // Other solution is also to let the user specify how many tokens have been sent + get
        // the return value from `add_liquidity`: it's more gas efficient but adds more verbose
        amountOut = lpToken().balanceOf(address(this));
    }

    /// @inheritdoc BaseLevSwapper
    function _remove(uint256 burnAmount, bytes memory data) internal override returns (uint256 amountOut) {
        CurveRemovalType removalType;
        (removalType, data) = abi.decode(data, (CurveRemovalType, bytes));
        if (removalType == CurveRemovalType.oneCoin) {
            (int128 whichCoin, uint256 minAmountOut) = abi.decode(data, (int128, uint256));
            amountOut = metapool().remove_liquidity_one_coin(burnAmount, whichCoin, minAmountOut);
        } else if (removalType == CurveRemovalType.balance) {
            uint256[2] memory minAmountOuts = abi.decode(data, (uint256[2]));
            minAmountOuts = metapool().remove_liquidity(burnAmount, minAmountOuts);
        } else if (removalType == CurveRemovalType.imbalance) {
            (address to, uint256[2] memory amountOuts) = abi.decode(data, (address, uint256[2]));
            uint256 actualBurnAmount = metapool().remove_liquidity_imbalance(amountOuts, burnAmount);
            // We may have withdrawn more than needed: maybe not optimal because a user may not want to have
            // lp tokens staked. Solution is to do a sweep on all tokens in the `BaseLevSwapper` contract
            if (burnAmount > actualBurnAmount) angleStaker().deposit(burnAmount - actualBurnAmount, to);
        }
    }

    // ============================= VIRTUAL FUNCTIONS =============================

    /// @notice Reference to the `token1` of the Curve pool
    function token1() public pure virtual returns (IERC20);

    /// @notice Reference to the `token2` of the Curve pool
    function token2() public pure virtual returns (IERC20);

    /// @notice Reference to the Curve Pool contract
    function metapool() public pure virtual returns (IMetaPool2);

    /// @notice Reference to the actual collateral contract
    /// @dev Most of the time this is the same address as the `metapool`
    function lpToken() public pure virtual returns (IERC20);
}
