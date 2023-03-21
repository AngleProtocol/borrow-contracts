// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

import "../interfaces/IAgToken.sol";
import "../interfaces/coreModule/IStableMaster.sol";
import "../interfaces/ITreasury.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/draft-ERC20PermitUpgradeable.sol";

/// @title AgEUR
/// @author Angle Labs, Inc.
/// @notice Base contract for agEUR, Angle's Euro stablecoin
/// @dev This contract is an upgraded version of the agEUR contract that was first deployed on Ethereum mainnet
contract AgEUR is IAgToken, ERC20PermitUpgradeable {
    // ================================= REFERENCES ================================

    /// @notice Reference to the `StableMaster` contract associated to agEUR
    address public stableMaster;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() initializer {}

    // ============================== ADDED PARAMETERS =============================

    /// @inheritdoc IAgToken
    mapping(address => bool) public isMinter;
    /// @notice Reference to the treasury contract which can grant minting rights
    address public treasury;
    /// @notice Boolean used to check whether the contract had been reinitialized after an upgrade
    bool public treasuryInitialized;

    // =================================== EVENTS ==================================

    event TreasuryUpdated(address indexed _treasury);
    event MinterToggled(address indexed minter);

    // =================================== ERRORS ==================================

    error BurnAmountExceedsAllowance();
    error InvalidSender();
    error InvalidTreasury();
    error NotGovernor();
    error NotMinter();
    error NotTreasury();
    error TreasuryAlreadyInitialized();

    // ================================= MODIFIERS =================================

    /// @notice Checks to see if it is the `Treasury` calling this contract
    modifier onlyTreasury() {
        if (msg.sender != treasury) revert NotTreasury();
        _;
    }

    /// @notice Checks whether the sender has the minting right
    modifier onlyMinter() {
        if (!isMinter[msg.sender]) revert NotMinter();
        _;
    }

    // ============================= EXTERNAL FUNCTION =============================

    /// @notice Allows anyone to burn stablecoins
    /// @param amount Amount of stablecoins to burn
    /// @dev This function can typically be called if there is a settlement mechanism to burn stablecoins
    function burnStablecoin(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    // ========================= MINTER ROLE ONLY FUNCTIONS ========================

    /// @inheritdoc IAgToken
    function burnSelf(uint256 amount, address burner) external onlyMinter {
        _burn(burner, amount);
    }

    /// @inheritdoc IAgToken
    function burnFrom(uint256 amount, address burner, address sender) external onlyMinter {
        if (burner != sender) {
            uint256 currentAllowance = allowance(burner, sender);
            if (currentAllowance < amount) revert BurnAmountExceedsAllowance();
            _approve(burner, sender, currentAllowance - amount);
        }
        _burn(burner, amount);
    }

    /// @inheritdoc IAgToken
    function mint(address account, uint256 amount) external onlyMinter {
        _mint(account, amount);
    }

    // ========================== TREASURY ONLY FUNCTIONS ==========================

    /// @inheritdoc IAgToken
    function addMinter(address minter) external onlyTreasury {
        isMinter[minter] = true;
        emit MinterToggled(minter);
    }

    /// @inheritdoc IAgToken
    function removeMinter(address minter) external {
        if (msg.sender != minter && msg.sender != address(treasury)) revert InvalidSender();
        isMinter[minter] = false;
        emit MinterToggled(minter);
    }

    /// @inheritdoc IAgToken
    function setTreasury(address _treasury) external onlyTreasury {
        treasury = _treasury;
        emit TreasuryUpdated(_treasury);
    }
}
