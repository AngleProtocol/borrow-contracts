// SPDX-License-Identifier: MIT

pragma solidity 0.8.12;

import "./utils/OFTCore.sol";
import "../../interfaces/IAgTokenSideChainMultiBridge.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

// TODO
// Tests
// Sweep functions to tackle eventual issues
contract LayerZeroBridgeToken is OFTCore, ERC20Upgradeable, PausableUpgradeable {
    IAgTokenSideChainMultiBridge public canonicalToken;

    uint256[49] private __gap;

    // =============================== Errors ================================

    error InvalidAllowance();

    // ============================= Constructor ===================================

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
        // Set the initial amount that could be bridged using this OFT
        _mint(address(canonicalToken), initialSupply);
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() initializer {}

    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return
            interfaceId == type(IOFT).interfaceId ||
            interfaceId == type(IERC20).interfaceId ||
            super.supportsInterface(interfaceId);
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
        canonicalToken.permit(msg.sender, address(this), _amount, deadline, v, r, s);
        _send(_dstChainId, _toAddress, _amount, _refundAddress, _zroPaymentAddress, _adapterParams);
    }

    // ============================= Internal Functions ===================================

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

    // ======================= Governance Functions ================================

    function mint(uint256 amount) external onlyGovernorOrGuardian {
        _mint(address(canonicalToken), amount);
    }

    function burn(uint256 amount) external onlyGovernorOrGuardian {
        _burn(address(canonicalToken), amount);
    }

    function setupAllowance() public onlyGovernorOrGuardian {
        _approve(address(this), address(canonicalToken), type(uint256).max);
    }

    function pauseSendTokens(bool pause) external onlyGovernorOrGuardian {
        pause ? _pause() : _unpause();
    }
}
