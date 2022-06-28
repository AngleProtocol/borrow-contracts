// SPDX-License-Identifier: MIT

pragma solidity 0.8.12;

import "./OFTCore.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// TODO
// Tests
// Pass upgradeable
// Add Permit ?
// Admin functions to remove ownable and use our access control
// Sweep functions to tackle eventual issues
contract AngleETHOFT is OFTCore, Pausable {
    /// @notice Address of the bridgeable token
    IERC20 public immutable token;

    /// @notice Maps an address to the amount of token bridged but not received
    mapping(address => uint256) public credit;

    // =============================== Errors ================================

    error InvalidSpender();

    // ============================= Constructor ===================================

    constructor(
        string memory _name,
        string memory _symbol,
        address _lzEndpoint,
        address _treasury
    ) OFTCore(_lzEndpoint, _treasury) {
        token = IERC20(address(ITreasury(_treasury).stablecoin()));
    }

    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return interfaceId == type(IOFT).interfaceId || super.supportsInterface(interfaceId);
    }

    function pauseSendTokens(bool pause) external onlyGovernorOrGuardian {
        pause ? _pause() : _unpause();
    }

    function _debitFrom(
        address _from,
        uint16,
        bytes memory,
        uint256 _amount
    ) internal override whenNotPaused returns (uint256) {
        if (_from != msg.sender) revert InvalidSpender();
        // No need to use safeTransferFrom as we know this implementation reverts on failure
        token.transferFrom(_from, address(this), _amount);
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

    function sweep(uint256 amount, address recipient) external onlyGovernorOrGuardian {
        credit[recipient] = credit[recipient] - amount; // Will overflow if the amount is too big
    }
}
