// SPDX-License-Identifier: MIT

pragma solidity 0.8.12;

import "./utils/OFTCore.sol";
import "../../interfaces/IAgTokenSideChainMultiBridge.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

/// @title LayerZeroBridgeToken
/// @author Angle Core Team, forked from https://github.com/LayerZero-Labs/solidity-examples/blob/main/contracts/token/oft/OFT.sol
/// @notice Contract to be deployed on a L2/sidechain for bridging an AgToken using a bridge intermediate token and LayerZero
contract LayerZeroBridgeToken is OFTCore, ERC20Upgradeable, PausableUpgradeable {
    /// @notice Address of the bridgeable token
    /// @dev Immutable
    IAgTokenSideChainMultiBridge public canonicalToken;

    // =============================== Errors ================================

    error InvalidAllowance();

    // ============================= Constructor ===================================

    /// @notice Initializes the contract
    /// @param _name Name of the token corresponding to this contract
    /// @param _symbol Symbol of the token corresponding to this contract
    /// @param _lzEndpoint Layer zero endpoint to pass messages
    /// @param _treasury Address of the treasury contract used for access control
    /// @param initialSupply Initial supply to mint to the canonical token address
    /// @dev The initial supply corresponds to the initial amount that could be bridged using this OFT
    function initialize(
        string memory _name,
        string memory _symbol,
        address _lzEndpoint,
        address _treasury,
        uint256 initialSupply
    ) external initializer {
        __ERC20_init_unchained(_name, _symbol);
        __LzAppUpgradeable_init(_lzEndpoint, _treasury);

        canonicalToken = IAgTokenSideChainMultiBridge(address(ITreasury(_treasury).stablecoin()));
        _approve(address(this), address(canonicalToken), type(uint256).max);
        _mint(address(canonicalToken), initialSupply);
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() initializer {}

    // ==================== External Permissionless Functions ======================

    /// @inheritdoc OFTCore
    function sendWithPermit(
        uint16 _dstChainId,
        bytes memory _toAddress,
        uint256 _amount,
        address payable _refundAddress,
        address _zroPaymentAddress,
        bytes memory _adapterParams,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public payable override {
        canonicalToken.permit(msg.sender, address(this), _amount, deadline, v, r, s);
        send(_dstChainId, _toAddress, _amount, _refundAddress, _zroPaymentAddress, _adapterParams);
    }

    /// @inheritdoc OFTCore
    function withdraw(uint256 amount, address recipient) external override whenNotPaused returns (uint256) {
        // Does not check allowances as transfers from `msg.sender`
        _transfer(msg.sender, address(this), amount);
        amount = canonicalToken.swapIn(address(this), amount, recipient);
        return amount;
    }

    // ============================= Internal Functions ===================================

    /// @inheritdoc OFTCore
    function _debitFrom(
        uint16,
        bytes memory,
        uint256 _amount
    ) internal override whenNotPaused returns (uint256) {
        // No need to use safeTransferFrom as we know this implementation reverts on failure
        canonicalToken.transferFrom(msg.sender, address(this), _amount);

        // Swap canonical for this bridge token. There may be some fees
        uint256 amountSwapped = canonicalToken.swapOut(address(this), _amount, address(this));
        _burn(address(this), amountSwapped);
        return amountSwapped;
    }

    /// @inheritdoc OFTCore
    function _creditTo(
        uint16,
        address _toAddress,
        uint256 _amount
    ) internal override whenNotPaused returns (uint256) {
        _mint(address(this), _amount);
        uint256 amountMinted = canonicalToken.swapIn(address(this), _amount, _toAddress);
        transfer(_toAddress, balanceOf(address(this)));
        return amountMinted;
    }

    // ======================= View Functions ================================

    /// @inheritdoc ERC165Upgradeable
    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return
            interfaceId == type(IOFT).interfaceId ||
            interfaceId == type(IERC20).interfaceId ||
            super.supportsInterface(interfaceId);
    }

    // ======================= Governance Functions ================================

    /// @notice Mints the intermediate contract to the `canonicalToken`
    /// @dev Used to increase the bridging capacity
    function mint(uint256 amount) external onlyGovernorOrGuardian {
        _mint(address(canonicalToken), amount);
    }

    /// @notice Burns the intermediate contract from the `canonicalToken`
    /// @dev Used to decrease the bridging capacity
    function burn(uint256 amount) external onlyGovernorOrGuardian {
        _burn(address(canonicalToken), amount);
    }

    /// @notice Increases allowance of the `canonicalToken`
    function setupAllowance() public onlyGovernorOrGuardian {
        _approve(address(this), address(canonicalToken), type(uint256).max);
    }

    /// @notice Pauses bridging through the contract
    /// @param pause Future pause status
    function pauseSendTokens(bool pause) external onlyGovernorOrGuardian {
        pause ? _pause() : _unpause();
    }

    uint256[49] private __gap;
}
