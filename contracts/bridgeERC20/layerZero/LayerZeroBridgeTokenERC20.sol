// SPDX-License-Identifier: MIT

pragma solidity 0.8.12;

import "./utils/OFTCoreERC20.sol";
import "../../interfaces/IAgTokenSideChainMultiBridge.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

/// @title LayerZeroBridgeTokenERC20
/// @author Angle Core Team, forked from https://github.com/LayerZero-Labs/solidity-examples/blob/main/contracts/token/oft/OFT.sol
/// @notice Contract to be deployed on a L2/sidechain for bridging a token (ANGLE for instance) using
/// a bridge intermediate token and LayerZero
contract LayerZeroBridgeTokenERC20 is OFTCoreERC20, ERC20Upgradeable, PausableUpgradeable {
    /// @notice Address of the bridgeable token
    IAgTokenSideChainMultiBridge public canonicalToken;

    // =================================== ERRORS ==================================

    error InvalidAllowance();

    // ================================ CONSTRUCTOR ================================

    /// @notice Initializes the contract
    /// @param _name Name of the token corresponding to this contract
    /// @param _symbol Symbol of the token corresponding to this contract
    /// @param _lzEndpoint Layer zero endpoint to pass messages
    /// @param _coreBorrow Address of the `CoreBorrow` contract used for access control
    /// @param _canonicalToken Address of the bridgeable token
    function initialize(
        string memory _name,
        string memory _symbol,
        address _lzEndpoint,
        address _coreBorrow,
        address _canonicalToken
    ) external initializer {
        if (_canonicalToken == address(0)) revert ZeroAddress();
        __ERC20_init_unchained(_name, _symbol);
        __LzAppUpgradeable_init(_lzEndpoint, _coreBorrow);

        canonicalToken = IAgTokenSideChainMultiBridge(_canonicalToken);
        _approve(address(this), _canonicalToken, type(uint256).max);
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() initializer {}

    // ===================== EXTERNAL PERMISSIONLESS FUNCTIONS =====================

    /// @inheritdoc OFTCoreERC20
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

    /// @inheritdoc OFTCoreERC20
    function withdraw(uint256 amount, address recipient) external override returns (uint256 amountMinted) {
        // Does not check allowances as transfers from `msg.sender`
        _transfer(msg.sender, address(this), amount);
        amountMinted = canonicalToken.swapIn(address(this), amount, recipient);
        uint256 leftover = balanceOf(address(this));
        if (leftover > 0) {
            _transfer(address(this), msg.sender, leftover);
        }
    }

    // ============================= INTERNAL FUNCTIONS ============================

    /// @inheritdoc OFTCoreERC20
    function _debitFrom(
        uint16,
        bytes memory,
        uint256 _amount
    ) internal override whenNotPaused returns (uint256 amountSwapped) {
        // No need to use safeTransferFrom as we know this implementation reverts on failure
        canonicalToken.transferFrom(msg.sender, address(this), _amount);

        // Swap canonical for this bridge token. There may be some fees
        amountSwapped = canonicalToken.swapOut(address(this), _amount, address(this));
        _burn(address(this), amountSwapped);
    }

    /// @inheritdoc OFTCoreERC20
    function _debitCreditFrom(
        uint16,
        bytes memory,
        uint256 _amount
    ) internal override whenNotPaused returns (uint256) {
        _burn(msg.sender, _amount);
        return _amount;
    }

    /// @inheritdoc OFTCoreERC20
    function _creditTo(
        uint16,
        address _toAddress,
        uint256 _amount
    ) internal override whenNotPaused returns (uint256 amountMinted) {
        _mint(address(this), _amount);
        amountMinted = canonicalToken.swapIn(address(this), _amount, _toAddress);
        uint256 leftover = balanceOf(address(this));
        if (leftover > 0) {
            _transfer(address(this), _toAddress, leftover);
        }
    }

    // =============================== VIEW FUNCTIONS ==============================

    /// @inheritdoc ERC165Upgradeable
    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return
            interfaceId == type(IOFT).interfaceId ||
            interfaceId == type(IERC20).interfaceId ||
            super.supportsInterface(interfaceId);
    }

    // ============================ GOVERNANCE FUNCTIONS ===========================

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
