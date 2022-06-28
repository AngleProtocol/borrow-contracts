// SPDX-License-Identifier: MIT

pragma solidity 0.8.12;

import "./OFTCore.sol";
import "../../interfaces/IAgTokenSideChainMultiBridge.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// TODO
// Tests
// Pass upgradeable
// Add Permit ?
// Admin functions to remove ownable and use our access control
// Sweep functions to tackle eventual issues
contract AngleOFT is OFTCore, ERC20, Pausable {
    IAgTokenSideChainMultiBridge public immutable canonicalToken;

    constructor(
        string memory _name,
        string memory _symbol,
        address _lzEndpoint,
        IAgTokenSideChainMultiBridge _canonicalToken,
        address _owner
    ) ERC20(_name, _symbol) OFTCore(_lzEndpoint) {
        canonicalToken = _canonicalToken;
        setupAllowance();
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

    function setupAllowance() public onlyOwner {
        _approve(address(this), address(canonicalToken), type(uint256).max);
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
        address spender = _msgSender();
        // Otherwise a simple allowance for the canonical token to this address could be exploited
        if (_from != spender) {
            uint256 currentAllowance = allowance(_from, _msgSender());
            require(currentAllowance >= _amount, "ERC20: transfer amount exceeds allowance");
            unchecked {
                _approve(_from, _msgSender(), currentAllowance - _amount);
            }
        }
        // No need to use safeTransferFrom as we know this implementation reverts on failure
        canonicalToken.transferFrom(_from, address(this), _amount);
        uint256 amountSwapped = canonicalToken.swapOut(address(this), _amount, address(this));
        _burn(address(this), amountSwapped);
        return amountSwapped;
    }

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
}
