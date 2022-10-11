// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.12;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../../interfaces/IAngleRouterSidechain.sol";
import "../../interfaces/ICoreBorrow.sol";
import "../../interfaces/IBorrowStaker.sol";
import "../../interfaces/external/uniswap/IUniswapRouter.sol";

import "../SwapperSidechain.sol";

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
        (leverage, data) = abi.decode(data, (bool, bytes));
        if (leverage) {
            address to;
            (to, data) = abi.decode(data, (address, bytes));
            amountOut = _leverage(data);
            ANGLE_STAKER.deposit(amountOut, to);
        } else {
            uint256 toUnstake;
            (toUnstake, data) = abi.decode(data, (uint256, bytes));
            // should transfer the token to th contract this will claim the rewards for the current owner of the wrapper
            ANGLE_STAKER.withdraw(toUnstake, address(this), address(this));
            amountOut = _deleverage(data);
        }
    }

    // ========================= INTERNAL VIRTUAL FUNCTIONS ========================

    function _leverage(bytes memory data) internal virtual returns (uint256 amountOut);

    function _deleverage(bytes memory data) internal virtual returns (uint256 amountOut);
}
