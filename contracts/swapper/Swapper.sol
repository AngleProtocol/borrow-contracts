// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../interfaces/IAngleRouter.sol";
import "../interfaces/ICoreBorrow.sol";
import "../interfaces/ISwapper.sol";
import "../interfaces/external/lido/IWStETH.sol";
import "../interfaces/external/uniswap/IUniswapRouter.sol";

/// @title Swapper
/// @author Angle Core Team
/// @notice Swapper contract facilitating interactions with the VaultManager: to liquidate and get leverage
contract Swapper is ISwapper {
    using SafeERC20 for IERC20;

    // ================ Constants and Immutable Variables ==========================

    /// @notice Base used for parameter computation
    uint256 public constant BASE_PARAMS = 10**9;
    /// @notice AngleRouter
    IAngleRouter public immutable angleRouter;
    /// @notice Reference to the Core contract of the module which handles all AccessControl logic
    ICoreBorrow public immutable core;
    /// @notice Wrapped StETH contract
    IWStETH public immutable wStETH;
    /// @notice Uniswap Router contract
    IUniswapV3Router public immutable uniV3Router;
    /// @notice 1Inch Router
    address public immutable oneInch;
    
    // =============================== Mappings ====================================

    /// @notice Whether the token was already approved on Uniswap router
    mapping(IERC20 => bool) public uniAllowedToken;
    /// @notice Whether the token was already approved on 1Inch
    mapping(IERC20 => bool) public oneInchAllowedToken;
    /// @notice Whether the token was already approved on AngleRouter
    mapping(IERC20 => bool) public angleRouterAllowedToken;

    // ================================== Enum =====================================

    /// @notice All possible swaps
    enum SwapType {
        UniswapV3,
        oneInch,
        Wrap,
        None
    }

    // =============================== Modifiers ===================================

    /// @notice Constructor of the contract
    /// @param _core Core address
    constructor(
        ICoreBorrow _core,
        IWStETH _wStETH,
        IUniswapV3Router _uniV3Router,
        address _oneInch,
        IAngleRouter _angleRouter
    ) {
        require(
            address(_core) != address(0) &&
                address(_uniV3Router) != address(0) &&
                _oneInch != address(0) &&
                address(_angleRouter) != address(0),
            "0"
        );
        core = _core;
        IERC20 stETH = IERC20(_wStETH.stETH());
        stETH.safeApprove(address(_wStETH), type(uint256).max);
        wStETH = _wStETH;
        uniV3Router = _uniV3Router;
        oneInch = _oneInch;
        angleRouter = _angleRouter;
    }

    receive() external payable {}

    /// @inheritdoc ISwapper
    function swap(
        IERC20 inToken,
        IERC20 outToken,
        address outTokenRecipient,
        uint256 outTokenOwed,
        uint256 inTokenObtained,
        bytes memory data
    ) external {
        address intermediateToken;
        address to;
        uint256 minAmountOut;
        uint128 swapType;
        uint128 mintOrBurn;
        // Reusing the `data` variable
        (intermediateToken, to, minAmountOut, swapType, mintOrBurn, data) = abi.decode(
            data,
            (address, address, uint256, uint128, uint128, bytes)
        );
        if (mintOrBurn == 0) minAmountOut = outTokenOwed;

        if (mintOrBurn == 1) {
            _checkAngleRouterAllowance(inToken);
            angleRouter.burn(address(this), inTokenObtained, minAmountOut, address(inToken), intermediateToken);
            inTokenObtained = IERC20(intermediateToken).balanceOf(address(this));
            inToken = IERC20(intermediateToken);
        }
        // Reusing the `inTokenObtained` variable
        inTokenObtained = _swap(inToken, inTokenObtained, minAmountOut, SwapType(swapType), data);

        if (mintOrBurn == 2) {
            _checkAngleRouterAllowance(IERC20(intermediateToken));
            angleRouter.mint(address(this), inTokenObtained, outTokenOwed, address(outToken), intermediateToken);
        }
        IERC20(outToken).safeTransfer(outTokenRecipient, outTokenOwed);
        IERC20(outToken).safeTransfer(to, outToken.balanceOf(address(this)));
    }

    /// @notice Changes allowance for a contract
    /// @param tokens Addresses of the tokens to allow
    /// @param spenders Addresses to allow transfer
    /// @param amounts Amounts to allow
    function changeAllowance(
        IERC20[] calldata tokens,
        address[] calldata spenders,
        uint256[] calldata amounts
    ) external {
        require(core.isGovernorOrGuardian(msg.sender), "2");
        require(tokens.length == spenders.length && tokens.length == amounts.length, "104");
        uint256 currentAllowance;
        for (uint256 i = 0; i < tokens.length; i++) {
            currentAllowance = tokens[i].allowance(address(this), spenders[i]);
            if (currentAllowance < amounts[i]) {
                tokens[i].safeIncreaseAllowance(spenders[i], amounts[i] - currentAllowance);
            } else if (currentAllowance > amounts[i]) {
                tokens[i].safeDecreaseAllowance(spenders[i], currentAllowance - amounts[i]);
                if (spenders[i] == address(uniV3Router)) delete uniAllowedToken[tokens[i]];
                else if (spenders[i] == oneInch) delete oneInchAllowedToken[tokens[i]];
                else if (spenders[i] == address(angleRouter)) delete angleRouterAllowedToken[tokens[i]];
            }
        }
    }

    /// @notice Changes allowance of this contract for a given token
    /// @param token Address of the token to change allowance
    /// @param spender Address to change the allowance of
    /// @param amount Amount allowed
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
            if (spender == address(uniV3Router)) delete uniAllowedToken[token];
            else if (spender == oneInch) delete oneInchAllowedToken[token];
            else if (spender == address(angleRouter)) delete angleRouterAllowedToken[token];
        }
    }

    function _swap(
        IERC20 inToken,
        uint256 amount,
        uint256 minAmountOut,
        SwapType swapType,
        bytes memory args
    ) internal returns (uint256 amountOut) {
        if (swapType == SwapType.UniswapV3) amountOut = _swapOnUniswapV3(inToken, amount, minAmountOut, args);
        else if (swapType == SwapType.oneInch) amountOut = _swapOn1Inch(inToken, minAmountOut, args);
        else if (swapType == SwapType.Wrap) amountOut = _wrapStETH(amount, minAmountOut);
        else require(swapType == SwapType.None, "3");
        return amountOut;
    }

    function _checkAngleRouterAllowance(IERC20 token) internal {
        if (!angleRouterAllowedToken[token]) {
            _changeAllowance(token, address(angleRouter), type(uint256).max);
            angleRouterAllowedToken[token] = true;
        }
    }

    function _swapOnUniswapV3(
        IERC20 inToken,
        uint256 amount,
        uint256 minAmountOut,
        bytes memory path
    ) internal returns (uint256 amountOut) {
        // Approve transfer to the `uniswapV3Router` if it is the first time that the token is used
        if (!uniAllowedToken[inToken]) {
            _changeAllowance(inToken, address(uniV3Router), type(uint256).max);
            uniAllowedToken[inToken] = true;
        }
        amountOut = uniV3Router.exactInput(
            ExactInputParams(path, address(this), block.timestamp, amount, minAmountOut)
        );
    }

    function _wrapStETH(uint256 amount, uint256 minAmountOut) internal returns (uint256 amountOut) {
        amountOut = wStETH.wrap(amount);
        require(amountOut >= minAmountOut, "15");
    }

    /// @notice Allows to swap any token to an accepted collateral via 1Inch API
    /// @param minAmountOut Minimum amount accepted for the swap to happen
    /// @param payload Bytes needed for 1Inch API
    function _swapOn1Inch(
        IERC20 inToken,
        uint256 minAmountOut,
        bytes memory payload
    ) internal returns (uint256 amountOut) {
        // Approve transfer to the `oneInch` router if it is the first time the token is used
        if (!oneInchAllowedToken[inToken]) {
            _changeAllowance(inToken, oneInch, type(uint256).max);
            oneInchAllowedToken[inToken] = true;
        }

        //solhint-disable-next-line
        (bool success, bytes memory result) = oneInch.call(payload);
        if (!success) _revertBytes(result);

        amountOut = abi.decode(result, (uint256));
        require(amountOut >= minAmountOut, "15");
    }

    /// @notice Internal function used for error handling
    function _revertBytes(bytes memory errMsg) internal pure {
        if (errMsg.length > 0) {
            //solhint-disable-next-line
            assembly {
                revert(add(32, errMsg), mload(errMsg))
            }
        }
        revert("117");
    }
}
