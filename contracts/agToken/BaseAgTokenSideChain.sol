// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

import "../interfaces/IAgToken.sol";
import "../interfaces/IStableMaster.sol";
import "../interfaces/ITreasury.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/draft-ERC20PermitUpgradeable.sol";

/// @title BaseAgTokenSideChain
/// @author Angle Core Team
/// @notice Base Contract for Angle agTokens to be deployed on any other chain than Ethereum mainnet
/// @dev This type of contract can be used to create and handle the stablecoins of Angle protocol in different chains than Ethereum
contract BaseAgTokenSideChain is IAgToken, ERC20PermitUpgradeable {
    // ======================= Parameters and Variables ============================

    /// @inheritdoc IAgToken
    mapping(address => bool) public isMinter;
    /// @notice Reference to the treasury contract which can grant minting rights
    address public treasury;

    // ================================== Events ===================================

    event TreasuryUpdated(address indexed _treasury);
    event MinterToggled(address indexed minter);

    // ============================= Constructor ===================================

    /// @notice Initializes the contract
    /// @param name_ Name of the token
    /// @param symbol_ Symbol of the token
    /// @param _treasury Reference to the `Treasury` contract associated to this agToken implementation
    /// @dev By default, agTokens are ERC-20 tokens with 18 decimals
    function _initialize(
        string memory name_,
        string memory symbol_,
        address _treasury
    ) internal initializer {
        __ERC20Permit_init(name_);
        __ERC20_init(name_, symbol_);
        require(address(ITreasury(_treasury).stablecoin()) == address(this), "6");
        treasury = _treasury;
        emit TreasuryUpdated(address(_treasury));
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() initializer {}

    // =============================== Modifiers ===================================

    /// @notice Checks to see if it is the `Treasury` calling this contract
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

    // =========================== External Function ===============================

    /// @notice Allows anyone to burn agToken without redeeming collateral back
    /// @param amount Amount of stablecoins to burn
    /// @dev This function can typically be called if there is a settlement mechanism to burn stablecoins
    function burnStablecoin(uint256 amount) external {
        _burn(msg.sender, amount);
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
