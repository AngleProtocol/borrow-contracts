// SPDX-License-Identifier: MIT

pragma solidity 0.8.12;

import "./utils/OFTCore.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/draft-IERC20Permit.sol";

// TODO
// Tests
// Admin functions to remove ownable and use our access control
// Sweep functions to tackle eventual issues
contract LayerZeroBridge is OFTCore, PausableUpgradeable {
    /// @notice Address of the bridgeable token
    IERC20 public token;

    /// @notice Maps an address to the amount of token bridged but not received
    mapping(address => uint256) public credit;

    uint256[48] private __gap;

    // ============================= Constructor ===================================

    function initialize(address _lzEndpoint, address _treasury) external initializer {
        __LzAppUpgradeable_init(_lzEndpoint, _treasury);
        token = IERC20(address(ITreasury(_treasury).stablecoin()));
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() initializer {}

    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return interfaceId == type(IOFT).interfaceId || super.supportsInterface(interfaceId);
    }

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
    ) public payable {
        IERC20Permit(address(token)).permit(msg.sender, address(this), _amount, deadline, v, r, s);
        _send(_dstChainId, _toAddress, _amount, _refundAddress, _zroPaymentAddress, _adapterParams);
    }

    function _debitFrom(
        uint16,
        bytes memory,
        uint256 _amount
    ) internal override whenNotPaused returns (uint256) {
        // No need to use safeTransferFrom as we know this implementation reverts on failure
        token.transferFrom(msg.sender, address(this), _amount);
        return _amount;
    }

    function _creditTo(
        uint16,
        address _toAddress,
        uint256 _amount
    ) internal override whenNotPaused returns (uint256) {
        // Should never revert as all the LayerZero bridge tokens come from
        // this contract
        uint256 balance = token.balanceOf(address(this));
        if (balance < _amount) {
            // TODO case where no transfer needed
            credit[_toAddress] = _amount - balance;
            token.transfer(_toAddress, balance);
        } else {
            token.transfer(_toAddress, _amount);
        }
        return _amount;
    }

    function withdraw(uint256 amount, address recipient) external whenNotPaused {
        credit[recipient] = credit[recipient] - amount; // Will overflow if the amount is too big
        token.transfer(recipient, amount);
    }

    // ======================= Governance Functions ================================

    function pauseSendTokens(bool pause) external onlyGovernorOrGuardian {
        pause ? _pause() : _unpause();
    }

    function sweep(uint256 amount, address recipient) external onlyGovernorOrGuardian {
        credit[recipient] = credit[recipient] - amount; // Will overflow if the amount is too big
    }
}
