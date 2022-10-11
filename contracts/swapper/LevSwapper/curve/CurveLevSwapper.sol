// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.12;

import "../BaseLevSwapper.sol";
import "../../../interfaces/external/curve/IMetaPool2.sol";

/// @notice All possible removal on Curve
enum CurveRemovalType {
    oneCoin,
    balance,
    imbalance
}

/// @title Leverage swapper on Curve LP tokens with Convex
/// @author Angle Core Team
abstract contract CurveLevSwapper is BaseLevSwapper {
    using SafeERC20 for IERC20;

    constructor(
        ICoreBorrow _core,
        IUniswapV3Router _uniV3Router,
        address _oneInch,
        IAngleRouterSidechain _angleRouter
    ) BaseLevSwapper(_core, _uniV3Router, _oneInch, _angleRouter) {}

    // =============================== MAIN FUNCTIONS ==============================

    function _leverage(bytes memory) internal override returns (uint256 amountOut) {
        // Instead of doing sweeps at the end just use the full balance to add liquidity
        uint256 amountAgToken = token1().balanceOf(address(this));
        uint256 amountCollateral = token2().balanceOf(address(this));
        IMetaPool2 _metaPool = metapool();
        token1().safeApprove(address(_metaPool), amountAgToken);
        token2().safeApprove(address(_metaPool), amountCollateral);
        // slippage is checked at the very end of the `swap` function
        amountOut = _metaPool.add_liquidity([amountAgToken, amountCollateral], 0);
        IERC20(_metaPool).safeApprove(address(ANGLE_STAKER), amountOut);
    }

    function _deleverage(uint256 burnAmount, bytes memory data) internal override returns (uint256 amountOut) {
        CurveRemovalType removalType = abi.decode(data, (CurveRemovalType));
        if (removalType == CurveRemovalType.oneCoin) {
            uint256 minAmountOut = abi.decode(data, (uint256));
            amountOut = metapool().remove_liquidity_one_coin(burnAmount, 0, minAmountOut);
        } else if (removalType == CurveRemovalType.balance) {
            uint256[2] memory minAmountOuts = abi.decode(data, (uint256[2]));
            minAmountOuts = metapool().remove_liquidity(burnAmount, minAmountOuts);
        } else if (removalType == CurveRemovalType.imbalance) {
            (address to, uint256[2] memory amountOuts) = abi.decode(data, (address, uint256[2]));
            uint256 actualBurnAmount = metapool().remove_liquidity_imbalance(amountOuts, burnAmount);
            // we may have withdrawn more than needed, maybe not optimal because a user may want have no lp token staked
            // maybe just do a sweep on all tokens in the `BaseLevSwapper` contract
            ANGLE_STAKER.deposit(burnAmount - actualBurnAmount, to);
        }
    }

    // ============================= VIRTUAL FUNCTIONS =============================

    /// @notice Reference to the `agToken` contract which route the leverage operation
    function token1() public pure virtual returns (IERC20);

    /// @notice Reference to the `collateral` contract which is the counterpart token in the Curve pool
    function token2() public pure virtual returns (IERC20);

    /// @notice Reference to the actual collateral contract
    function metapool() public pure virtual returns (IMetaPool2);
}
