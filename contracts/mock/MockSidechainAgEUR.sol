// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

import "../agToken/BaseAgTokenSideChain.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title AgTokenSideChainMultiBridge
/// @author Angle Labs, Inc.
/// @notice Contract for Angle agTokens on other chains than Ethereum mainnet
/// @dev This contract supports bridge tokens having a minting right on the stablecoin (also referred to as the canonical
/// or the native token)
/// @dev References:
///      - FRAX implementation: https://polygonscan.com/address/0x45c32fA6DF82ead1e2EF74d17b76547EDdFaFF89#code
///      - QiDAO implementation: https://snowtrace.io/address/0x5c49b268c9841AFF1Cc3B0a418ff5c3442eE3F3b#code
contract MockSidechainAgEUR is BaseAgTokenSideChain {
    using SafeERC20 for IERC20;

    /// @notice Base used for fee computation
    uint256 public constant BASE_PARAMS = 10**9;

    // =============================== Bridging Data ===============================

    /// @notice Struct with some data about a specific bridge token
    struct BridgeDetails {
        // Limit on the balance of bridge token held by the contract: it is designed
        // to reduce the exposure of the system to hacks
        uint256 limit;
        // Limit on the hourly volume of token minted through this bridge
        // Technically the limit over a rolling hour is hourlyLimit x2 as hourly limit
        // is enforced only between x:00 and x+1:00
        uint256 hourlyLimit;
        // Fee taken for swapping in and out the token
        uint64 fee;
        // Whether the associated token is allowed or not
        bool allowed;
        // Whether swapping in and out from the associated token is paused or not
        bool paused;
    }

    /// @notice Maps a bridge token to data
    mapping(address => BridgeDetails) public bridges;
    /// @notice List of all bridge tokens
    address[] public bridgeTokensList;
    /// @notice Maps a bridge token to the associated hourly volume
    mapping(address => mapping(uint256 => uint256)) public usage;
    /// @notice Maps an address to whether it is exempt of fees for when it comes to swapping in and out
    mapping(address => uint256) public isFeeExempt;

    // ================================== Events ===================================

    event BridgeTokenAdded(address indexed bridgeToken, uint256 limit, uint256 hourlyLimit, uint64 fee, bool paused);
    event BridgeTokenToggled(address indexed bridgeToken, bool toggleStatus);
    event BridgeTokenRemoved(address indexed bridgeToken);
    event BridgeTokenFeeUpdated(address indexed bridgeToken, uint64 fee);
    event BridgeTokenLimitUpdated(address indexed bridgeToken, uint256 limit);
    event BridgeTokenHourlyLimitUpdated(address indexed bridgeToken, uint256 hourlyLimit);
    event HourlyLimitUpdated(uint256 hourlyLimit);
    event Recovered(address indexed token, address indexed to, uint256 amount);
    event FeeToggled(address indexed theAddress, uint256 toggleStatus);

    // =============================== Errors ================================

    error AssetStillControlledInReserves();
    error HourlyLimitExceeded();
    error InvalidToken();
    error NotGovernor();
    error NotGovernorOrGuardian();
    error TooBigAmount();
    error TooHighParameterValue();
    error ZeroAddress();

    // ============================= Constructor ===================================

    /// @notice Initializes the `AgToken` contract
    /// @param name_ Name of the token
    /// @param symbol_ Symbol of the token
    /// @param _treasury Reference to the `Treasury` contract associated to this agToken
    /// @dev By default, agTokens are ERC-20 tokens with 18 decimals
    function initialize(
        string memory name_,
        string memory symbol_,
        address _treasury
    ) external {
        _initialize(name_, symbol_, _treasury);
    }

    // =============================== Modifiers ===================================

    /// @notice Checks whether the `msg.sender` has the governor role or not
    modifier onlyGovernor() {
        if (!ITreasury(treasury).isGovernor(msg.sender)) revert NotGovernor();
        _;
    }

    /// @notice Checks whether the `msg.sender` has the governor role or the guardian role
    modifier onlyGovernorOrGuardian() {
        if (!ITreasury(treasury).isGovernorOrGuardian(msg.sender)) revert NotGovernorOrGuardian();
        _;
    }

    // ==================== External Permissionless Functions ======================

    /// @notice Returns the list of all supported bridge tokens
    /// @dev Helpful for UIs
    function allBridgeTokens() external view returns (address[] memory) {
        return bridgeTokensList;
    }

    /// @notice Returns the current volume for a bridge, for the current hour
    /// @param bridgeToken Bridge used to mint
    /// @dev Helpful for UIs
    function currentUsage(address bridgeToken) external view returns (uint256) {
        return usage[bridgeToken][block.timestamp / 3600];
    }

    /// @notice Mints the canonical token from a supported bridge token
    /// @param bridgeToken Bridge token to use to mint
    /// @param amount Amount of bridge tokens to send
    /// @param to Address to which the stablecoin should be sent
    /// @return Amount of the canonical stablecoin actually minted
    /// @dev Some fees may be taken by the protocol depending on the token used and on the address calling
    function swapIn(
        address bridgeToken,
        uint256 amount,
        address to
    ) external returns (uint256) {
        BridgeDetails memory bridgeDetails = bridges[bridgeToken];
        if (!bridgeDetails.allowed || bridgeDetails.paused) revert InvalidToken();
        uint256 balance = IERC20(bridgeToken).balanceOf(address(this));
        if (balance + amount > bridgeDetails.limit) {
            // In case someone maliciously sends tokens to this contract
            // Or the limit changes
            if (bridgeDetails.limit > balance) amount = bridgeDetails.limit - balance;
            else {
                amount = 0;
            }
        }

        // Checking requirement on the hourly volume
        uint256 hour = block.timestamp / 3600;
        uint256 hourlyUsage = usage[bridgeToken][hour] + amount;
        if (hourlyUsage > bridgeDetails.hourlyLimit) {
            // Edge case when the hourly limit changes
            if (bridgeDetails.hourlyLimit > usage[bridgeToken][hour])
                amount = bridgeDetails.hourlyLimit - usage[bridgeToken][hour];
            else {
                amount = 0;
            }
        }
        usage[bridgeToken][hour] = usage[bridgeToken][hour] + amount;

        IERC20(bridgeToken).safeTransferFrom(msg.sender, address(this), amount);
        uint256 canonicalOut = amount;
        // Computing fees
        if (isFeeExempt[msg.sender] == 0) {
            canonicalOut -= (canonicalOut * bridgeDetails.fee) / BASE_PARAMS;
        }
        _mint(to, canonicalOut);
        return canonicalOut;
    }

    /// @notice Burns the canonical token in exchange for a bridge token
    /// @param bridgeToken Bridge token required
    /// @param amount Amount of canonical tokens to burn
    /// @param to Address to which the bridge token should be sent
    /// @return Amount of bridge tokens actually sent back
    /// @dev Some fees may be taken by the protocol depending on the token used and on the address calling
    function swapOut(
        address bridgeToken,
        uint256 amount,
        address to
    ) external returns (uint256) {
        BridgeDetails memory bridgeDetails = bridges[bridgeToken];
        if (!bridgeDetails.allowed || bridgeDetails.paused) revert InvalidToken();

        _burn(msg.sender, amount);
        uint256 bridgeOut = amount;
        if (isFeeExempt[msg.sender] == 0) {
            bridgeOut -= (bridgeOut * bridgeDetails.fee) / BASE_PARAMS;
        }
        IERC20(bridgeToken).safeTransfer(to, bridgeOut);
        return bridgeOut;
    }

    // ======================= Governance Functions ================================

    /// @notice Adds support for a bridge token
    /// @param bridgeToken Bridge token to add: it should be a version of the stablecoin from another bridge
    /// @param limit Limit on the balance of bridge token this contract could hold
    /// @param hourlyLimit Limit on the hourly volume for this bridge
    /// @param paused Whether swapping for this token should be paused or not
    /// @param fee Fee taken upon swapping for or against this token
    function addBridgeToken(
        address bridgeToken,
        uint256 limit,
        uint256 hourlyLimit,
        uint64 fee,
        bool paused
    ) external onlyGovernor {
        if (bridges[bridgeToken].allowed || bridgeToken == address(0)) revert InvalidToken();
        if (fee > BASE_PARAMS) revert TooHighParameterValue();
        BridgeDetails memory _bridge;
        _bridge.limit = limit;
        _bridge.hourlyLimit = hourlyLimit;
        _bridge.paused = paused;
        _bridge.fee = fee;
        _bridge.allowed = true;
        bridges[bridgeToken] = _bridge;
        bridgeTokensList.push(bridgeToken);
        emit BridgeTokenAdded(bridgeToken, limit, hourlyLimit, fee, paused);
    }

    /// @notice Removes support for a token
    /// @param bridgeToken Address of the bridge token to remove support for
    function removeBridgeToken(address bridgeToken) external onlyGovernor {
        if (IERC20(bridgeToken).balanceOf(address(this)) != 0) revert AssetStillControlledInReserves();
        delete bridges[bridgeToken];
        // Deletion from `bridgeTokensList` loop
        uint256 bridgeTokensListLength = bridgeTokensList.length;
        for (uint256 i; i < bridgeTokensListLength - 1; ++i) {
            if (bridgeTokensList[i] == bridgeToken) {
                // Replace the `bridgeToken` to remove with the last of the list
                bridgeTokensList[i] = bridgeTokensList[bridgeTokensListLength - 1];
                break;
            }
        }
        // Remove last element in array
        bridgeTokensList.pop();
        emit BridgeTokenRemoved(bridgeToken);
    }

    /// @notice Recovers any ERC20 token
    /// @dev Can be used to withdraw bridge tokens for them to be de-bridged on mainnet
    function recoverERC20(
        address tokenAddress,
        address to,
        uint256 amountToRecover
    ) external onlyGovernor {
        IERC20(tokenAddress).safeTransfer(to, amountToRecover);
        emit Recovered(tokenAddress, to, amountToRecover);
    }

    /// @notice Updates the `limit` amount for `bridgeToken`
    function setLimit(address bridgeToken, uint256 limit) external onlyGovernorOrGuardian {
        if (!bridges[bridgeToken].allowed) revert InvalidToken();
        bridges[bridgeToken].limit = limit;
        emit BridgeTokenLimitUpdated(bridgeToken, limit);
    }

    /// @notice Updates the `hourlyLimit` amount for `bridgeToken`
    function setHourlyLimit(address bridgeToken, uint256 hourlyLimit) external onlyGovernorOrGuardian {
        if (!bridges[bridgeToken].allowed) revert InvalidToken();
        bridges[bridgeToken].hourlyLimit = hourlyLimit;
        emit BridgeTokenHourlyLimitUpdated(bridgeToken, hourlyLimit);
    }

    /// @notice Updates the `fee` value for `bridgeToken`
    function setSwapFee(address bridgeToken, uint64 fee) external onlyGovernorOrGuardian {
        if (!bridges[bridgeToken].allowed) revert InvalidToken();
        if (fee > BASE_PARAMS) revert TooHighParameterValue();
        bridges[bridgeToken].fee = fee;
        emit BridgeTokenFeeUpdated(bridgeToken, fee);
    }

    /// @notice Pauses or unpauses swapping in and out for a token
    function toggleBridge(address bridgeToken) external onlyGovernorOrGuardian {
        if (!bridges[bridgeToken].allowed) revert InvalidToken();
        bool pausedStatus = bridges[bridgeToken].paused;
        bridges[bridgeToken].paused = !pausedStatus;
        emit BridgeTokenToggled(bridgeToken, !pausedStatus);
    }

    /// @notice Toggles fees for the address `theAddress`
    function toggleFeesForAddress(address theAddress) external onlyGovernorOrGuardian {
        uint256 feeExemptStatus = 1 - isFeeExempt[theAddress];
        isFeeExempt[theAddress] = feeExemptStatus;
        emit FeeToggled(theAddress, feeExemptStatus);
    }
}
