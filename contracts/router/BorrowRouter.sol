// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/draft-IERC20PermitUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../interfaces/IAgToken.sol";
import "../interfaces/IAngleRouter.sol";
import "../interfaces/ICoreBorrow.sol";
import "../interfaces/IRepayCallee.sol";
import "../interfaces/IFlashAngle.sol";
import "../interfaces/ITreasury.sol";
import "../interfaces/IVaultManager.sol";
import "../interfaces/external/IWETH9.sol";
import "../interfaces/external/lido/IWStETH.sol";
import "../interfaces/external/uniswap/IUniswapRouter.sol";

/// @title BorrowRouter
/// @author Angle Core Team
/// @notice Router contract facilitating interactions with the VaultManager
contract BorrowRouter is Initializable, IRepayCallee {
    using SafeERC20 for IERC20;

    // =============================== Constants ===================================

    /// @notice Base used for parameter computation
    uint256 public constant BASE_PARAMS = 10**9;
    /// @notice Wrapped ETH contract
    IWETH9 public constant WETH9 = IWETH9(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2);
    /// @notice Wrapped StETH contract
    IWStETH public constant WSTETH = IWStETH(0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0);
    /// @notice Uniswap Router contract
    IUniswapV3Router public constant UNIV3ROUTER = IUniswapV3Router(0xE592427A0AEce92De3Edee1F18E0157C05861564);
    /// @notice 1Inch Router
    address public constant ONEINCH = 0x1111111254fb6c44bAC0beD2854e76F90643097d;

    // =============================== References ==================================

    /// @notice Reference to the Core contract of the module which handles all AccessControl logic
    ICoreBorrow public core;
    /// @notice Reference to the `AngleRouter` contract
    IAngleRouter public angleRouter;

    // =============================== Mappings ====================================

    /// @notice Maps a `vaultManager` contract to its associated collateral. This mapping is used to check whether
    /// a `vaultManager` is supported within this router contract
    mapping(IVaultManager => IERC20) public supportedVaultManagers;
    /// @notice Whether the token was already approved on Uniswap router
    mapping(IERC20 => bool) public uniAllowedToken;
    /// @notice Whether the token was already approved on 1Inch
    mapping(IERC20 => bool) public oneInchAllowedToken;
    /// @notice Whether the token was already approved on AngleRouter
    mapping(IERC20 => bool) public angleRouterAllowedToken;

    // =========================== Structs and Enums ===============================

    /// @notice All possible swaps
    enum SwapType {
        UniswapV3,
        oneINCH,
        Wrap
    }

    /// @notice Params for swaps
    /// @param inToken Token to swap
    /// @param collateral Token to swap for
    /// @param amountIn Amount of token to sell
    /// @param minAmountOut Minimum amount of collateral to receive for the swap to not revert
    /// @param args Either the path for Uniswap or the payload for 1Inch
    /// @param swapType Which swap route to take
    struct ParamsSwapType {
        IERC20 inToken;
        uint256 amountIn;
        uint256 minAmountOut;
        bytes args;
        SwapType swapType;
    }

    /// @notice Data needed to get permits
    struct PermitType {
        address token;
        address owner;
        uint256 value;
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    // TODO: add events

    // =============================== Modifiers ===================================

    /// @notice Checks whether the `msg.sender` has the governor role or not
    modifier onlyGovernor() {
        require(core.isGovernor(msg.sender), "1");
        _;
    }

    /// @notice Checks whether the `msg.sender` has the governor role or not
    modifier onlyGovernorOrGuardian() {
        require(core.isGovernorOrGuardian(msg.sender), "1");
        _;
    }

    function initialize(
        ICoreBorrow _core,
        IAngleRouter _angleRouter,
        IVaultManager[] memory vaultManagers
    ) external initializer {
        require(address(_core) != address(0), "0");
        core = _core;
        angleRouter = _angleRouter;
        _toggleVaultManagers(vaultManagers);
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {}

    receive() external payable {}

    function mixer(
        PermitType[] memory paramsPermit,
        ParamsSwapType[] memory paramsSwap,
        IVaultManager vaultManager,
        ActionType[] memory actions,
        bytes[] memory datas,
        bytes memory addressData,
        bytes memory repayData
    ) external payable {
        for (uint256 i = 0; i < paramsPermit.length; i++) {
            IERC20PermitUpgradeable(paramsPermit[i].token).permit(
                paramsPermit[i].owner,
                address(this),
                paramsPermit[i].value,
                paramsPermit[i].deadline,
                paramsPermit[i].v,
                paramsPermit[i].r,
                paramsPermit[i].s
            );
        }

        for (uint256 i = 0; i < paramsSwap.length; i++) {
            _transferAndSwap(
                paramsSwap[i].inToken,
                paramsSwap[i].amountIn,
                paramsSwap[i].minAmountOut,
                paramsSwap[i].swapType,
                paramsSwap[i].args
            );
        }

        {
            (address to, address who) = abi.decode(addressData,(address,address));
            vaultManager.angle(actions, datas, msg.sender, to, who, repayData);
            IERC20 collateral = supportedVaultManagers[vaultManager];
            require(address(collateral) != address(0));
            collateral.safeTransfer(to, collateral.balanceOf(address(this)));
        }
    }

    /// @inheritdoc IRepayCallee
    function repayCallStablecoin(
        address stablecoinRecipient,
        uint256 stablecoinOwed,
        uint256 collateralObtained,
        bytes calldata data
    ) external {
        IERC20 inToken = supportedVaultManagers[IVaultManager(msg.sender)];
        require(address(inToken) != address(0));
        address stablecoin;
        address to;
        uint256 swapType;
        uint256 minAmountOut;
        address collateral;
        bytes memory swapData;
        (stablecoin, to, swapType, minAmountOut, collateral, swapData) = abi.decode(
            data,
            (address, address, uint256, uint256, address, bytes)
        );
        uint256 amountOut = _swap(inToken, collateralObtained, minAmountOut, SwapType(swapType), swapData);
        if (collateral != address(0) && address(angleRouter) != address(0)) {
            _mintFromProtocol(inToken, amountOut, stablecoinOwed, stablecoin, collateral);
        }
        IERC20(stablecoin).safeTransfer(stablecoinRecipient, stablecoinOwed);
        IERC20(stablecoin).safeTransfer(to, IERC20(stablecoin).balanceOf(address(this)));
    }

    /// @inheritdoc IRepayCallee
    function repayCallCollateral(
        address collateralRecipient,
        uint256 stablecoinObtained,
        uint256 collateralOwed,
        bytes calldata data
    ) external {
        IERC20 outToken = supportedVaultManagers[IVaultManager(msg.sender)];
        require(address(outToken) != address(0));
        address stablecoin;
        address to;
        uint256 swapType;
        uint256 minAmountOut;
        address collateral;
        bytes memory swapData;
        (stablecoin, to, swapType, minAmountOut, collateral, swapData) = abi.decode(
            data,
            (address, address, uint256, uint256, address, bytes)
        );
        if (collateral != stablecoin && address(angleRouter) != address(0)) {
            angleRouter.burn(address(this), stablecoinObtained, minAmountOut, stablecoin, collateral);
            // Reusing the `stablecoinObtained` variable in this case
            stablecoinObtained = IERC20(collateral).balanceOf(address(this));
        }
        _swap(IERC20(collateral), stablecoinObtained, collateralOwed, SwapType(swapType), swapData);
        outToken.safeTransfer(collateralRecipient, collateralOwed);
        outToken.safeTransfer(to, outToken.balanceOf(address(this)));
    }

    function toggleVaultManagers(IVaultManager[] memory vaultManagers) external onlyGovernorOrGuardian {
        _toggleVaultManagers(vaultManagers);
    }

    /// @notice Changes allowance for a contract
    /// @param tokens Addresses of the tokens to allow
    /// @param spenders Addresses to allow transfer
    /// @param amounts Amounts to allow
    /// @dev This function should be called prior to setting a new router contract to revoke old allowances
    /// and grant new ones
    function changeAllowance(
        IERC20[] calldata tokens,
        address[] calldata spenders,
        uint256[] calldata amounts
    ) external onlyGovernorOrGuardian {
        require(tokens.length == spenders.length && tokens.length == amounts.length, "104");
        for (uint256 i = 0; i < tokens.length; i++) {
            _changeAllowance(tokens[i], spenders[i], amounts[i]);
        }
    }

    function setAngleRouter(IAngleRouter _angleRouter) external onlyGovernor {
        angleRouter = _angleRouter;
    }

    function _transferAndSwap(
        IERC20 inToken,
        uint256 amount,
        uint256 minAmountOut,
        SwapType swapType,
        bytes memory args
    ) internal returns (uint256) {
        if (address(this).balance >= amount) {
            if (address(inToken) == address(WETH9)) {
                WETH9.deposit{ value: amount }();
            } else if (address(inToken) == address(WSTETH)) {
                //solhint-disable-next-line
                (bool success, bytes memory result) = address(WSTETH).call{ value: amount }("");
                if (!success) _revertBytes(result);
            }
        } else {
            inToken.safeTransferFrom(msg.sender, address(this), amount);
        }
        return _swap(inToken, amount, minAmountOut, swapType, args);
    }

    function _swap(
        IERC20 inToken,
        uint256 amount,
        uint256 minAmountOut,
        SwapType swapType,
        bytes memory args
    ) internal returns (uint256 amountOut) {
        if (swapType == SwapType.UniswapV3) amountOut = _swapOnUniswapV3(inToken, amount, minAmountOut, args);
        else if (swapType == SwapType.oneINCH) amountOut = _swapOn1Inch(inToken, minAmountOut, args);
        else if (swapType == SwapType.Wrap) amountOut = _wrapStETH(amount, minAmountOut);
        else require(false, "3");
        return amountOut;
    }

    function _mintFromProtocol(
        IERC20 inToken,
        uint256 amount,
        uint256 minAmountOut,
        address stablecoin,
        address collateral
    ) internal {
        if (!angleRouterAllowedToken[inToken]) {
            // TODO: should we just give a limited allowance to the router and avoid all these scenari
            inToken.safeIncreaseAllowance(address(angleRouter), type(uint256).max);
            angleRouterAllowedToken[inToken] = true;
        }
        angleRouter.mint(address(this), amount, minAmountOut, stablecoin, collateral);
    }

    function _swapOnUniswapV3(
        IERC20 inToken,
        uint256 amount,
        uint256 minAmountOut,
        bytes memory path
    ) internal returns (uint256 amountOut) {
        // Approve transfer to the `uniswapV3Router` if it is the first time that the token is used
        if (!uniAllowedToken[inToken]) {
            inToken.safeIncreaseAllowance(address(UNIV3ROUTER), type(uint256).max);
            uniAllowedToken[inToken] = true;
        }
        amountOut = UNIV3ROUTER.exactInput(
            ExactInputParams(path, address(this), block.timestamp, amount, minAmountOut)
        );
    }

    function _wrapStETH(uint256 amount, uint256 minAmountOut) internal returns (uint256 amountOut) {
        // TODO should add approval here as well somewhere
        amountOut = WSTETH.wrap(amount);
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
            inToken.safeIncreaseAllowance(ONEINCH, type(uint256).max);
            oneInchAllowedToken[inToken] = true;
        }

        //solhint-disable-next-line
        (bool success, bytes memory result) = ONEINCH.call(payload);
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
        }
    }

    function _toggleVaultManagers(IVaultManager[] memory vaultManagers) internal {
        for (uint256 i = 0; i < vaultManagers.length; i++) {
            IERC20 collateral = supportedVaultManagers[vaultManagers[i]];
            if (address(collateral) == address(0)) {
                collateral = vaultManagers[i].collateral();
                ITreasury treasury = vaultManagers[i].treasury();
                require(treasury.isVaultManager(address(vaultManagers[i])));
                _changeAllowance(collateral, address(vaultManagers[i]), type(uint256).max);
            } else {
                _changeAllowance(collateral, address(vaultManagers[i]), 0);
                collateral = IERC20(address(0));
            }
            supportedVaultManagers[vaultManagers[i]] = collateral;
        }
    }
}
