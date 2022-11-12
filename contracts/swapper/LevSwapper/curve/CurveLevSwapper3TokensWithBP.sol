// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.12;

import "../BaseLevSwapper.sol";
import "../../../interfaces/external/curve/IMetaPool3.sol";
import "hardhat/console.sol";

/// @notice All possible removals on Curve
enum CurveRemovalType {
    oneCoin,
    balance,
    imbalance,
    none
}

/// @title CurveLevSwapper3TokensWithBP
/// @author Angle Labs, Inc
/// @dev Leverage swapper on Curve LP tokens
/// @dev This implementation is for Curve pools with 3 tokens and 1 token is a Curve (3 token) LP token
/// @dev The implementation suppose that the LP `basepool` token is at index 0
abstract contract CurveLevSwapper3TokensWithBP is BaseLevSwapper {
    using SafeERC20 for IERC20;

    uint256 public constant NBR_TOKEN_META = 3;
    uint256 public constant NBR_TOKEN_BP = 3;

    constructor(
        ICoreBorrow _core,
        IUniswapV3Router _uniV3Router,
        address _oneInch,
        IAngleRouterSidechain _angleRouter
    ) BaseLevSwapper(_core, _uniV3Router, _oneInch, _angleRouter) {}

    // =============================== MAIN FUNCTIONS ==============================

    /// @inheritdoc BaseLevSwapper
    function _add(bytes memory data) internal override returns (uint256 amountOut) {
        // First, if needed, add liquidity on the base pool to get the BP LP tokens
        bool addOnBP = abi.decode(data, (bool));
        if (addOnBP) {
            // Instead of doing sweeps at the end just use the full balance to add liquidity
            uint256 amountTokenBP1 = tokensBP()[0].balanceOf(address(this));
            uint256 amountTokenBP2 = tokensBP()[1].balanceOf(address(this));
            uint256 amountTokenBP3 = tokensBP()[2].balanceOf(address(this));
            // Slippage is checked at the very end of the `swap` function
            basepool().add_liquidity([amountTokenBP1, amountTokenBP2, amountTokenBP3], 0);
        }
        // Instead of doing sweeps at the end just use the full balance to add liquidity
        uint256 amountTokenLP = tokens()[0].balanceOf(address(this));
        uint256 amountToken1 = tokens()[1].balanceOf(address(this));
        uint256 amountToken2 = tokens()[2].balanceOf(address(this));
        // Slippage is checked at the very end of the `swap` function
        if (amountTokenLP > 0 || amountToken1 > 0 || amountToken2 > 0) {
            console.log("gas left before add_liquidity", gasleft());
            metapool().add_liquidity([amountTokenLP, amountToken1, amountToken2], 0);
            console.log("just after adding liquidity ");
        }

        // Other solution is also to let the user specify how many tokens have been sent + get
        // the return value from `add_liquidity`: it's more gas efficient but adds more verbose
        amountOut = lpToken().balanceOf(address(this));
    }

    /// @inheritdoc BaseLevSwapper
    /// @dev For some pools `CurveRemovalType.imbalance` may be impossible
    function _remove(uint256 burnAmount, bytes memory data) internal override returns (uint256 amountOut) {
        CurveRemovalType removalType;
        bool swapLPBP;
        (removalType, swapLPBP, data) = abi.decode(data, (CurveRemovalType, bool, bytes));
        uint256 lpTokenBPReceived;
        if (removalType == CurveRemovalType.oneCoin) {
            (uint256 whichCoin, uint256 minAmountOut) = abi.decode(data, (uint256, uint256));
            amountOut = metapool().remove_liquidity_one_coin(burnAmount, whichCoin, minAmountOut);
            lpTokenBPReceived = whichCoin == 0 ? amountOut : 0;
        } else if (removalType == CurveRemovalType.balance) {
            uint256[3] memory minAmountOuts = abi.decode(data, (uint256[3]));
            minAmountOuts = metapool().remove_liquidity(burnAmount, minAmountOuts);
            lpTokenBPReceived == minAmountOuts[0];
        } else if (removalType == CurveRemovalType.imbalance) {
            (address to, uint256[3] memory amountOuts) = abi.decode(data, (address, uint256[3]));
            uint256 actualBurnAmount = metapool().remove_liquidity_imbalance(amountOuts, burnAmount);
            lpTokenBPReceived = amountOuts[0];
            // We may have withdrawn more than needed: maybe not optimal because a user may not want to have
            // lp tokens staked. Solution is to do a sweep on all tokens in the `BaseLevSwapper` contract
            if (burnAmount > actualBurnAmount) angleStaker().deposit(burnAmount - actualBurnAmount, to);
        }
        if (swapLPBP) _removeBP(lpTokenBPReceived, data);
    }

    /// @notice Remove liquidity from the `basepool`
    /// @param burnAmount Amount of LP token to burn
    /// @param data External data to process the removal
    function _removeBP(uint256 burnAmount, bytes memory data) internal returns (uint256 amountOut) {
        CurveRemovalType removalType;
        (removalType, data) = abi.decode(data, (CurveRemovalType, bytes));
        if (removalType == CurveRemovalType.oneCoin) {
            (int128 whichCoin, uint256 minAmountOut) = abi.decode(data, (int128, uint256));
            amountOut = basepool().remove_liquidity_one_coin(burnAmount, whichCoin, minAmountOut);
        } else if (removalType == CurveRemovalType.balance) {
            uint256[3] memory minAmountOuts = abi.decode(data, (uint256[3]));
            minAmountOuts = basepool().remove_liquidity(burnAmount, minAmountOuts);
        } else if (removalType == CurveRemovalType.imbalance) {
            (address to, uint256[3] memory amountOuts) = abi.decode(data, (address, uint256[3]));
            uint256 actualBurnAmount = metapool().remove_liquidity_imbalance(amountOuts, burnAmount);
            // We may have withdrawn more than needed: maybe not optimal because a user may not want to have
            // lp tokens staked. Solution is to do a sweep on all tokens in the `BaseLevSwapper` contract
            if (burnAmount > actualBurnAmount) angleStaker().deposit(burnAmount - actualBurnAmount, to);
        }
    }

    // ============================= VIRTUAL FUNCTIONS =============================

    /// @notice Reference to the native `tokens` of the Curve pool
    function tokens() public pure virtual returns (IERC20[3] memory);

    /// @notice Reference to the Curve Pool contract
    function metapool() public pure virtual returns (IMetaPool3);

    /// @notice Reference to the actual collateral contract
    /// @dev Most of the time this is the same address as the `metapool`
    function lpToken() public pure virtual returns (IERC20);

    /// @notice Reference to the native `tokens` of the Curve `basepool`
    function tokensBP() public pure virtual returns (IERC20[3] memory);

    /// @notice Reference to the Curve Pool contract
    function basepool() public pure virtual returns (IMetaPool3);
}
