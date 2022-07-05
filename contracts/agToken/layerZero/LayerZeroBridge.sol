// SPDX-License-Identifier: MIT

pragma solidity 0.8.12;

import "./utils/OFTCore.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/draft-IERC20Permit.sol";

/// @title LayerZeroBridge
/// @author Angle Core Team, forked from https://github.com/LayerZero-Labs/solidity-examples/blob/main/contracts/token/oft/OFT.sol
/// @notice Contract to be deployed on Ethereum for bridging an AgToken using a bridge intermediate token and LayerZero
contract LayerZeroBridge is OFTCore, PausableUpgradeable {
    /// @notice Address of the bridgeable token
    /// @dev Immutable
    IERC20 public canonicalToken;

    /// @notice Maps an address to the amount of token bridged but not received
    mapping(address => uint256) public balanceOf;

    // ============================= Constructor ===================================

    /// @notice Initializes the contract
    /// @param _lzEndpoint Layer zero endpoint to pass messages
    /// @param _treasury Address of the treasury contract used for access control
    function initialize(address _lzEndpoint, address _treasury) external initializer {
        __LzAppUpgradeable_init(_lzEndpoint, _treasury);
        canonicalToken = IERC20(address(ITreasury(_treasury).stablecoin()));
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
        IERC20Permit(address(canonicalToken)).permit(msg.sender, address(this), _amount, deadline, v, r, s);
        send(_dstChainId, _toAddress, _amount, _refundAddress, _zroPaymentAddress, _adapterParams);
    }

    /// @inheritdoc OFTCore
    function withdraw(uint256 amount, address recipient) external override returns (uint256) {
        return _withdraw(amount, msg.sender, recipient);
    }

    /// @notice Withdraws amount of `token` from the contract and sends it to the recipient
    /// @param amount Amount to withdraw
    /// @param recipient Address to withdraw for
    /// @return The amount of canonical token sent
    function withdrawFor(uint256 amount, address recipient) external returns (uint256) {
        return _withdraw(amount, recipient, recipient);
    }

    // ========================== Internal Functions ===============================

    /// @notice Withdraws `amount` from the balance of the `from` address and sends these tokens to the `to` address
    /// @dev It's important to make sure that `from` is either the `msg.sender` or that `from` and `to` are the same
    /// addresses
    function _withdraw(
        uint256 amount,
        address from,
        address to
    ) internal whenNotPaused returns (uint256) {
        balanceOf[from] = balanceOf[from] - amount; // Will overflow if the amount is too big
        canonicalToken.transfer(to, amount);
        return amount;
    }

    /// @inheritdoc OFTCore
    function _debitFrom(
        uint16,
        bytes memory,
        uint256 _amount
    ) internal override whenNotPaused returns (uint256) {
        // No need to use safeTransferFrom as we know this implementation reverts on failure
        canonicalToken.transferFrom(msg.sender, address(this), _amount);
        return _amount;
    }

    /// @inheritdoc OFTCore
    function _debitCreditFrom(
        uint16,
        bytes memory,
        uint256 _amount
    ) internal override whenNotPaused returns (uint256) {
        balanceOf[msg.sender] -= _amount;
        return _amount;
    }

    /// @inheritdoc OFTCore
    function _creditTo(
        uint16,
        address _toAddress,
        uint256 _amount
    ) internal override whenNotPaused returns (uint256) {
        // Should never revert as all the LayerZero bridge tokens come from
        // this contract
        uint256 balance = canonicalToken.balanceOf(address(this));
        if (balance < _amount) {
            balanceOf[_toAddress] = _amount - balance;
            if (balance > 0) canonicalToken.transfer(_toAddress, balance);
        } else {
            canonicalToken.transfer(_toAddress, _amount);
        }
        return _amount;
    }

    // ========================= View Functions ====================================

    /// @inheritdoc ERC165Upgradeable
    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return interfaceId == type(IOFTCore).interfaceId || super.supportsInterface(interfaceId);
    }

    // ======================= Governance Functions ================================

    /// @notice Pauses bridging through the contract
    /// @param pause Future pause status
    function pauseSendTokens(bool pause) external onlyGovernorOrGuardian {
        pause ? _pause() : _unpause();
    }

    /// @notice Decreases the balance of an address
    /// @param amount Amount to withdraw from balance
    /// @param recipient Address to withdraw from
    function sweep(uint256 amount, address recipient) external onlyGovernorOrGuardian {
        balanceOf[recipient] = balanceOf[recipient] - amount; // Will overflow if the amount is too big
    }

    uint256[48] private __gap;
}
