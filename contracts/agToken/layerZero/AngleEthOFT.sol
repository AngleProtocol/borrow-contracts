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
contract AngleETHOFT is OFTCore, ERC20, Pausable {
    IERC20 public immutable token;

    constructor(
        string memory _name,
        string memory _symbol,
        address _lzEndpoint,
        IERC20 _token,
        address _owner
    ) ERC20(_name, _symbol) OFTCore(_lzEndpoint) {
        token = _token;
        _transferOwnership(_owner);
    }

    function circulatingSupply() public view virtual override returns (uint256) {
        return totalSupply();
    }

    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return
            interfaceId == type(IOFT).interfaceId ||
            interfaceId == type(IERC20).interfaceId ||
            super.supportsInterface(interfaceId);
    }

    function pauseSendTokens(bool pause) external onlyOwner {
        pause ? _pause() : _unpause();
    }

    function _debitFrom(
        address _from,
        uint16,
        bytes memory,
        uint256 _amount
    ) internal override whenNotPaused returns (uint256) {
        require(_from == msg.sender, "AngleETHOFT: Invalid spender");
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
        transfer(_toAddress, _amount);
        return _amount;
    }
}
