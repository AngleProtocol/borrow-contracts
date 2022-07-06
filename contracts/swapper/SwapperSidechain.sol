// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../interfaces/IAngleRouterSidechain.sol";
import "../interfaces/ICoreBorrow.sol";
import "../interfaces/ISwapper.sol";
import "../interfaces/external/lido/IWStETH.sol";
import "../interfaces/external/uniswap/IUniswapRouter.sol";

/// @title SwapperSidechain
/// @author Angle Core Team
/// @notice Swapper contract facilitating interactions with the VaultManager: to liquidate and get leverage
contract SwapperSidechain is ISwapper {
    using SafeERC20 for IERC20;

    // ================ Constants and Immutable Variables ==========================

    /// @notice Reference to the `CoreBorrow` contract of the module which handles all AccessControl logic
    ICoreBorrow public immutable core;
    /// @notice Uniswap Router contract
    IUniswapV3Router public immutable uniV3Router;
    /// @notice 1Inch Router
    address public immutable oneInch;
    /// @notice AngleRouter
    IAngleRouterSidechain public immutable angleRouter;

    // ================================== Enum =====================================

    /// @notice All possible swaps
    enum SwapType {
        UniswapV3,
        oneInch,
        AngleRouter,
        None
    }

    // ================================== Errors ===================================

    error EmptyReturnMessage();
    error IncompatibleLengths();
    error NotGovernorOrGuardian();
    error TooSmallAmountOut();
    error ZeroAddress();

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
    ) {
        if (
            address(_core) == address(0) ||
            address(_uniV3Router) == address(0) ||
            _oneInch == address(0) ||
            address(_angleRouter) == address(0)
        ) revert ZeroAddress();
        core = _core;
        uniV3Router = _uniV3Router;
        oneInch = _oneInch;
        angleRouter = _angleRouter;
    }

    // ======================= External Access Function ============================

    /// @inheritdoc ISwapper
    /// @dev This function swaps the `inToken` to the `outToken` by doing a UniV3 swap, a 1Inch swap or by interacting
    /// with the `AngleRouter` contract
    /// @dev One slippage check is performed at the end of the call
    /// @dev In this implementation, the function tries to make sure that the `outTokenRecipient` address has at the end
    /// of the call `outTokenOwed`, leftover tokens are sent to a `to` address which by default is the `outTokenRecipient`
    function swap(
        IERC20 inToken,
        IERC20 outToken,
        address outTokenRecipient,
        uint256 outTokenOwed,
        uint256 inTokenObtained,
        bytes memory data
    ) external {
        // Address to receive the surplus amount of token at the end of the call
        address to;
        // For slippage protection, it is checked at the end of the call
        uint256 minAmountOut;
        // Type of the swap to execute: if `swapType == 3`, then it is optional to swap
        uint128 swapType;
        // We're reusing the `data` variable (it can be `path` on UniswapV3, a payload for 1Inch or like encoded actions
        // for a router call)
        (to, minAmountOut, swapType, data) = abi.decode(data, (address, uint256, uint128, bytes));

        to = (to == address(0)) ? outTokenRecipient : to;

        _swap(inToken, inTokenObtained, SwapType(swapType), data);

        // A final slippage check is performed after the swaps
        uint256 outTokenBalance = outToken.balanceOf(address(this));
        if (outTokenBalance < minAmountOut) revert TooSmallAmountOut();

        // The `outTokenRecipient` may already have enough in balance, in which case there's no need to transfer
        // this address the token and everything can be given already to the `to` address
        uint256 outTokenBalanceRecipient = outToken.balanceOf(outTokenRecipient);
        if (outTokenBalanceRecipient >= outTokenOwed || to == outTokenRecipient)
            outToken.safeTransfer(to, outTokenBalance);
        else {
            // The `outTokenRecipient` should receive the delta to make sure its end balance is equal to `outTokenOwed`
            // Any leftover in this case is sent to the `to` address
            // The function reverts if it did not obtain more than `outTokenOwed - outTokenBalanceRecipient` from the swap
            outToken.safeTransfer(outTokenRecipient, outTokenOwed - outTokenBalanceRecipient);
            outToken.safeTransfer(to, outTokenBalanceRecipient + outTokenBalance - outTokenOwed);
        }
        // Reusing the `inTokenObtained` variable for the `inToken` balance
        // Sending back the remaining amount of inTokens to the `to` address: it is possible that not the full `inTokenObtained`
        // is swapped to `outToken` if we're using the `1Inch` payload
        inTokenObtained = inToken.balanceOf(address(this));
        if (inTokenObtained > 0) inToken.safeTransfer(to, inTokenObtained);
    }

    // ========================= Governance Function ===============================

    /// @notice Changes allowances of this contract for different tokens
    /// @param tokens Addresses of the tokens to allow
    /// @param spenders Addresses to allow transfer
    /// @param amounts Amounts to allow
    function changeAllowance(
        IERC20[] calldata tokens,
        address[] calldata spenders,
        uint256[] calldata amounts
    ) external {
        if (!core.isGovernorOrGuardian(msg.sender)) revert NotGovernorOrGuardian();
        if (tokens.length != spenders.length || tokens.length != amounts.length) revert IncompatibleLengths();
        for (uint256 i = 0; i < tokens.length; i++) {
            _changeAllowance(tokens[i], spenders[i], amounts[i]);
        }
    }

    // ======================= Internal Utility Functions ==========================

    /// @notice Internal version of the `_changeAllowance` function
    function _changeAllowance(
        IERC20 token,
        address spender,
        uint256 amount
    ) internal {
        uint256 currentAllowance = token.allowance(address(this), spender);
        if (currentAllowance < amount) {
            token.safeIncreaseAllowance(spender, amount - currentAllowance);
        } else if (currentAllowance > amount) {
            token.safeDecreaseAllowance(spender, currentAllowance - amount);
        }
    }

    /// @notice Checks the allowance for a contract and updates it to the max if it is not big enough
    /// @param token Token for which allowance should be checked
    /// @param spender Address to grant allowance to
    /// @param amount Minimum amount of tokens needed for the allowance
    function _checkAllowance(
        IERC20 token,
        address spender,
        uint256 amount
    ) internal {
        uint256 currentAllowance = token.allowance(address(this), spender);
        if (currentAllowance < amount) token.safeIncreaseAllowance(spender, type(uint256).max - currentAllowance);
    }

    /// @notice Performs a swap using either Uniswap, 1Inch. This function can also stake stETH to wstETH
    /// @param inToken Token to swap
    /// @param amount Amount of tokens to swap
    /// @param swapType Type of the swap to perform
    /// @param args Extra args for the swap: in the case of Uniswap it should be a path, for 1Inch it should be
    /// a payload
    /// @dev This function does nothing if `swapType` is None and it simply passes on the `amount` it received
    function _swap(
        IERC20 inToken,
        uint256 amount,
        SwapType swapType,
        bytes memory args
    ) internal {
        if (swapType == SwapType.UniswapV3) _swapOnUniswapV3(inToken, amount, args);
        else if (swapType == SwapType.oneInch) _swapOn1Inch(inToken, args);
        else if (swapType == SwapType.AngleRouter) _angleRouterActions(inToken, args);
    }

    /// @notice Performs a UniswapV3 swap
    /// @param inToken Token to swap
    /// @param amount Amount of tokens to swap
    /// @param path Path for the UniswapV3 swap: this encodes the out token that is going to be obtained
    /// @dev We don't specify a slippage here as in the `swap` function a final slippage check
    /// is performed at the end
    /// @dev This function does not check the out token obtained here: if it is wrongly specified, either
    /// the `swap` function could fail or these tokens could stay on the contract
    function _swapOnUniswapV3(
        IERC20 inToken,
        uint256 amount,
        bytes memory path
    ) internal returns (uint256 amountOut) {
        // We need more than `amount` of allowance to the contract
        _checkAllowance(inToken, address(uniV3Router), amount);
        amountOut = uniV3Router.exactInput(ExactInputParams(path, address(this), block.timestamp, amount, 0));
    }

    /// @notice Allows to swap any token to an accepted collateral via 1Inch API
    /// @param inToken Token received for the 1Inch swap
    /// @param payload Bytes needed for 1Inch API
    /// @dev Here again, we don't specify a slippage here as in the `swap` function a final slippage check
    /// is performed at the end
    function _swapOn1Inch(IERC20 inToken, bytes memory payload) internal returns (uint256 amountOut) {
        _changeAllowance(inToken, oneInch, type(uint256).max);
        //solhint-disable-next-line
        (bool success, bytes memory result) = oneInch.call(payload);
        if (!success) _revertBytes(result);
        amountOut = abi.decode(result, (uint256));
    }

    /// @notice Performs actions with the router contract of the protocol on the corresponding chain
    /// @param inToken Token concerned by the action and for which
    function _angleRouterActions(IERC20 inToken, bytes memory args) internal {
        (ActionType[] memory actions, bytes[] memory actionData) = abi.decode(args, (ActionType[], bytes[]));
        _changeAllowance(inToken, address(angleRouter), type(uint256).max);
        PermitType[] memory permits;
        angleRouter.mixer(permits, actions, actionData);
    }

    /// @notice Internal function used for error handling
    /// @param errMsg Error message received
    function _revertBytes(bytes memory errMsg) internal pure {
        if (errMsg.length > 0) {
            //solhint-disable-next-line
            assembly {
                revert(add(32, errMsg), mload(errMsg))
            }
        }
        revert EmptyReturnMessage();
    }
}
