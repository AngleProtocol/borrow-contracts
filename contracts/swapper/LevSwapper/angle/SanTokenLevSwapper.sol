// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.12;

import "../BaseLevSwapper.sol";
import "../../../interfaces/coreModule/IStableMaster.sol";

/// @title SanTokenLevSwapper
/// @author Angle Labs, Inc.
/// @dev Leverage Swapper on SanTokens
abstract contract SanTokenLevSwapper is BaseLevSwapper {
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
        uint256 amount = collateral().balanceOf(address(this));
        if (amount > 0) stableMaster().deposit(amount, address(this), poolManager());
        amountOut = sanToken().balanceOf(address(this));
    }

    /// @inheritdoc BaseLevSwapper
    function _remove(uint256 amount, bytes memory data) internal override returns (uint256 amountOut) {
        uint256 minAmountOut = abi.decode(data, (uint256));
        stableMaster().withdraw(amount, address(this), address(this), poolManager());
        amountOut = collateral().balanceOf(address(this));
        // We let this check because the caller may swap part of the tokens received and therefore
        // the check in the base swapper will only be for the out token
        if (amountOut < minAmountOut) revert TooSmallAmountOut();
    }

    // ============================= VIRTUAL FUNCTIONS =============================

    /// @notice Reference to the `stableMaster` contract which gives us access to the yield bearing token
    function stableMaster() public pure virtual returns (IStableMaster);

    /// @notice Reference to `poolManager` which is the reserve owner
    function poolManager() public pure virtual returns (address);

    /// @notice Reference to the `collateral` contract on which the poolManager depends on
    function collateral() public pure virtual returns (IERC20);

    /// @notice Reference to the `sanToken` contract which then needs to be staked
    function sanToken() public pure virtual returns (IERC20);
}
