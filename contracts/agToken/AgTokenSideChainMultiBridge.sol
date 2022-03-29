// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

import "../interfaces/IAgToken.sol";
import "../interfaces/IStableMaster.sol";
import "../interfaces/ITreasury.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/draft-ERC20PermitUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title AgTokenSideChainMultiBridge
/// @author Angle Core Team
/// @notice Contract for Angle agTokens to be deployed on any other chain than Ethereum mainnet
/// @dev This contract is used to create and handle the stablecoins of Angle protocol in a different chain than Ethereum
/// @dev This contract supports bridge tokens having a minting right on the stablecoin (also referred to as the canonical
/// token)
/// @dev References:
///      - FRAX implementation: https://polygonscan.com/address/0x45c32fA6DF82ead1e2EF74d17b76547EDdFaFF89#code
///      - QiDAO implementation: https://snowtrace.io/address/0x5c49b268c9841AFF1Cc3B0a418ff5c3442eE3F3b#code

contract AgTokenSideChainMultiBridge is IAgToken, ERC20PermitUpgradeable {
    using SafeERC20 for IERC20;

    /// @notice Base used for fee computation
    uint256 public constant BASE_PARAMS = 10**9;

    // ======================= Parameters and Variables ============================

    /// @inheritdoc IAgToken
    mapping(address => bool) public isMinter;
    /// @notice Reference to the treasury contract which can grant minting rights
    address public treasury;

    // =============================== Bridging Data ===============================

    /// @notice Struct with some data about a specific bridge token
    struct BridgeDetails {
        // Whether the associated token is allowed or not
        bool allowed;
        // Whether swapping in and out from the associated token is paused or not
        bool paused;
        // Limit on the balance of bridge token held by the contract: it is designed
        // to reduce the exposure of the system to hacks
        uint256 limit;
        // Fee taken for swapping in and out the token
        uint64 fee;
    }

    /// @notice Maps a bridge token to data
    mapping(address => BridgeDetails) public bridges;
    /// @notice List of all bridge tokens
    address[] public bridgeTokensList;
    /// @notice Maps an address to whether it is exempt of fees for when it comes to swapping in and out
    mapping(address => bool) public isFeeExempt;

    // ================================== Events ===================================

    event TreasuryUpdated(address indexed _treasury);
    event MinterToggled(address indexed minter);
    event BridgeTokenAdded(address indexed bridgeToken, uint256 limit, uint64 fee, bool paused);
    event BridgeTokenToggled(address indexed bridgeToken, bool toggleStatus);
    event BridgeTokenRemoved(address indexed bridgeToken);
    event BridgeTokenFeeUpdated(address indexed bridgeToken, uint64 fee);
    event BridgeTokenLimitUpdated(address indexed bridgeToken, uint256 limit);
    event Recovered(address indexed token, address indexed to, uint256 amount);
    event FeeToggled(address indexed theAddress, bool toggleStatus);

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
    ) external initializer {
        __ERC20Permit_init(name_);
        __ERC20_init(name_, symbol_);
        require(address(ITreasury(_treasury).stablecoin()) == address(this), "6");
        treasury = _treasury;
        emit TreasuryUpdated(address(_treasury));
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() initializer {}

    // =============================== Modifiers ===================================

    /// @notice Checks to see if it is the `StableMaster` calling this contract
    /// @dev There is no Access Control here, because it can be handled cheaply through this modifier
    modifier onlyTreasury() {
        require(msg.sender == address(treasury), "1");
        _;
    }

    /// @notice Checks whether the sender has the minting right
    modifier onlyMinter() {
        require(isMinter[msg.sender], "35");
        _;
    }

    /// @notice Checks whether the `msg.sender` has the governor role or not
    modifier onlyGovernor() {
        require(ITreasury(treasury).isGovernor(msg.sender), "1");
        _;
    }

    /// @notice Checks whether the `msg.sender` has the governor role or the guardian role
    modifier onlyGovernorOrGuardian() {
        require(ITreasury(treasury).isGovernorOrGuardian(msg.sender), "2");
        _;
    }

    // ==================== External Permissionless Functions ======================

    /// @notice Returns the list of all supported bridge tokens
    /// @dev It is helpful for UIs
    function allBridgeTokens() external view returns (address[] memory) {
        return bridgeTokensList;
    }

    /// @notice Allows anyone to burn agToken without redeeming collateral back
    /// @param amount Amount of stablecoins to burn
    /// @dev This function can typically be called if there is a settlement mechanism to burn stablecoins
    function burnStablecoin(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    /// @notice Mints the canonical token from a supported bridge token
    /// @param bridgeToken Bridge token to use to mint
    /// @param amount Amount of bridge tokens to send
    /// @param to Address to which the stablecoin should be sent
    /// @dev Some fees may be taken by the protocol depending on the token used and on the address calling
    function swapIn(
        address bridgeToken,
        uint256 amount,
        address to
    ) external {
        BridgeDetails memory bridgeDetails = bridges[bridgeToken];
        require(bridgeDetails.allowed && !bridgeDetails.paused, "51");
        require(
            bridgeDetails.limit > 0 && IERC20(bridgeToken).balanceOf(address(this)) + amount <= bridgeDetails.limit,
            "4"
        );
        IERC20(bridgeToken).safeTransfer(to, amount);
        uint256 canonicalOut = amount;
        // Computing fees
        if (!isFeeExempt[msg.sender]) {
            canonicalOut -= (canonicalOut * bridgeDetails.fee) / BASE_PARAMS;
        }
        _mint(to, canonicalOut);
    }

    /// @notice Burns the canonical token in exchange for a bridge token
    /// @param bridgeToken Bridge token required
    /// @param amount Amount of canonical tokens to burn
    /// @param to Address to which the bridge token should be sent
    /// @dev Some fees may be taken by the protocol depending on the token used and on the address calling
    function swapOut(
        address bridgeToken,
        uint256 amount,
        address to
    ) external {
        BridgeDetails memory bridgeDetails = bridges[bridgeToken];
        require(bridgeDetails.allowed && !bridgeDetails.paused, "51");
        _burn(msg.sender, amount);
        uint256 bridgeOut = amount;
        if (!isFeeExempt[msg.sender]) {
            bridgeOut -= (bridgeOut * bridgeDetails.fee) / BASE_PARAMS;
        }
        IERC20(bridgeToken).safeTransfer(to, bridgeOut);
    }

    // ======================= Minter Role Only Functions ==========================

    /// @notice Destroys `amount` token from the caller without giving collateral back
    /// @param amount Amount to burn
    /// @param poolManager Reference to the `PoolManager` contract for which the `stocksUsers` will
    /// need to be updated
    /// @dev This function is left here if we want to deploy Angle Core Module on Polygon: it has been restricted
    /// to a minter role only
    function burnNoRedeem(uint256 amount, address poolManager) external onlyMinter {
        _burn(msg.sender, amount);
        IStableMaster(msg.sender).updateStocksUsers(amount, poolManager);
    }

    /// @notice Burns `amount` of agToken on behalf of another account without redeeming collateral back
    /// @param account Account to burn on behalf of
    /// @param amount Amount to burn
    /// @param poolManager Reference to the `PoolManager` contract for which the `stocksUsers` will need to be updated
    /// @dev This function is left here if we want to deploy Angle Core Module on Polygon: it has been restricted
    /// to a minter role only
    function burnFromNoRedeem(
        address account,
        uint256 amount,
        address poolManager
    ) external onlyMinter {
        _burnFromNoRedeem(amount, account, msg.sender);
        IStableMaster(msg.sender).updateStocksUsers(amount, poolManager);
    }

    /// @inheritdoc IAgToken
    function burnSelf(uint256 amount, address burner) external onlyMinter {
        _burn(burner, amount);
    }

    /// @inheritdoc IAgToken
    function burnFrom(
        uint256 amount,
        address burner,
        address sender
    ) external onlyMinter {
        _burnFromNoRedeem(amount, burner, sender);
    }

    /// @inheritdoc IAgToken
    function mint(address account, uint256 amount) external onlyMinter {
        _mint(account, amount);
    }

    // ======================= Treasury Only Functions =============================

    /// @inheritdoc IAgToken
    function addMinter(address minter) external onlyTreasury {
        require(minter != address(0), "0");
        isMinter[minter] = true;
        emit MinterToggled(minter);
    }

    /// @inheritdoc IAgToken
    function removeMinter(address minter) external {
        require(msg.sender == address(treasury) || msg.sender == minter, "36");
        isMinter[minter] = false;
        emit MinterToggled(minter);
    }

    /// @inheritdoc IAgToken
    function setTreasury(address _treasury) external onlyTreasury {
        treasury = _treasury;
        emit TreasuryUpdated(_treasury);
    }

    // ======================= Governance Functions ================================

    /// @notice Adds support for a bridge token
    /// @param bridgeToken Bridge token to add: it should be a version of the stablecoin from another bridge
    /// @param limit Limit on the balance of bridge token this contract could hold
    /// @param paused Whether swapping for this token should be paused or not
    /// @param fee Fee taken upon swapping for or against this token
    function addBridgeToken(
        address bridgeToken,
        uint256 limit,
        uint64 fee,
        bool paused
    ) external onlyGovernor {
        require(!bridges[bridgeToken].allowed, "51");
        require(fee <= BASE_PARAMS, "9");
        BridgeDetails memory _bridge;
        _bridge.limit = limit;
        _bridge.paused = paused;
        _bridge.fee = fee;
        _bridge.allowed = true;
        bridges[bridgeToken] = _bridge;
        bridgeTokensList.push(bridgeToken);
        emit BridgeTokenAdded(bridgeToken, limit, fee, paused);
    }

    /// @notice Removes support for a token
    /// @param bridgeToken Address of the bridge token to remove support for
    function removeBridgeToken(address bridgeToken) external onlyGovernor {
        require(IERC20(bridgeToken).balanceOf(address(this)) == 0, "54");
        delete bridges[bridgeToken];
        // Deletion from `bridgeTokensList` loop
        uint256 bridgeTokensListLength = bridgeTokensList.length;
        for (uint256 i = 0; i < bridgeTokensListLength - 1; i++) {
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
        require(!bridges[bridgeToken].allowed, "51");
        bridges[bridgeToken].limit = limit;
        emit BridgeTokenLimitUpdated(bridgeToken, limit);
    }

    /// @notice Updates the `fee` value for `bridgeToken`
    function setSwapFee(address bridgeToken, uint64 fee) external onlyGovernorOrGuardian {
        require(fee <= BASE_PARAMS, "9");
        bridges[bridgeToken].fee = fee;
        emit BridgeTokenFeeUpdated(bridgeToken, fee);
    }

    /// @notice Pauses or unpauses swapping in and out for a token
    function toggleBridge(address bridgeToken) external onlyGovernorOrGuardian {
        require(bridges[bridgeToken].allowed, "51");
        bool pausedStatus = bridges[bridgeToken].paused;
        bridges[bridgeToken].paused = !pausedStatus;
        emit BridgeTokenToggled(bridgeToken, !pausedStatus);
    }

    /// @notice Toggles fees for the address `theAddress`
    function toggleFeesForAddress(address theAddress) external onlyGovernorOrGuardian {
        bool feeExemptStatus = isFeeExempt[theAddress];
        isFeeExempt[theAddress] = !feeExemptStatus;
        emit FeeToggled(theAddress, !feeExemptStatus);
    }

    // ============================ Internal Function ==============================

    /// @notice Internal version of the function `burnFromNoRedeem`
    /// @param amount Amount to burn
    /// @dev It is at the level of this function that allowance checks are performed
    function _burnFromNoRedeem(
        uint256 amount,
        address burner,
        address sender
    ) internal {
        if (burner != sender) {
            uint256 currentAllowance = allowance(burner, sender);
            require(currentAllowance >= amount, "23");
            _approve(burner, sender, currentAllowance - amount);
        }
        _burn(burner, amount);
    }
}
