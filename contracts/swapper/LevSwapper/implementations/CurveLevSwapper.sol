// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.12;

import "../BaseLevSwapper.sol";
import "../../../interfaces/external/curve/IMetaPool2.sol";

/// @title Leverage Swapper from agEUR to Curve LP agEUR-EUROC
/// @author Angle Core Team
contract CurveLevSwapper is BaseLevSwapper {
    using SafeERC20 for IERC20;

    // ================================= CONSTANTS =================================

    /// @notice Reference to the `agToken` contract which route the leverage operation
    IERC20 public constant AGTOKEN = IERC20(address(0));
    /// @notice Reference to the `collateral` contract which is the counterpart token in the Curve pool
    IERC20 public constant COLLATERAL = IERC20(address(0));
    /// @notice Reference to the actual collateral contract
    IMetaPool2 public constant METAPOOL = IMetaPool2(address(0));

    // =================================== ERRORS ==================================

    constructor(
        ICoreBorrow _core,
        IUniswapV3Router _uniV3Router,
        address _oneInch,
        IAngleRouterSidechain _angleRouter
    ) BaseLevSwapper(_core, _uniV3Router, _oneInch, _angleRouter) {}

    // =============================== MAIN FUNCTIONS ==============================

    function _leverage(bytes memory data) internal override returns (uint256 amountOut) {
        // TODO add possible swaps to have a more balance add_liquidity
        (bool swaps, uint256 amountAgToken, uint256 amountCollateral, uint256 minAmountOut) = abi.decode(
            data,
            (bool, uint256, uint256, uint256)
        );
        AGTOKEN.safeApprove(address(METAPOOL), amountAgToken);
        COLLATERAL.safeApprove(address(METAPOOL), amountCollateral);
        amountOut = METAPOOL.add_liquidity([amountAgToken, amountCollateral], minAmountOut);
        IERC20(METAPOOL).safeApprove(address(ANGLE_STAKER), amountOut);
    }

    function _deleverage(bytes memory data) internal override returns (uint256 amountOut) {
        (uint256 burnAmount, uint256 minAmountOut) = abi.decode(data, (uint256, uint256));
        // TODO add possible remove liquidity (imbalance and/or classic) + swaps to have a full flexible withdraw
        amountOut = METAPOOL.remove_liquidity_one_coin(burnAmount, 0, minAmountOut);
    }
}
