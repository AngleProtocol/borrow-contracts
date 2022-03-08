// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

import "../interfaces/IAgToken.sol";
import "../interfaces/IStableMaster.sol";
import "../interfaces/ITreasury.sol";
// OpenZeppelin may update its version of the ERC20PermitUpgradeable token
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/draft-ERC20PermitUpgradeable.sol";

/// @title AgToken
/// @author Angle Core Team
/// @notice Base contract for agToken, that is to say Angle's stablecoins
/// @dev This contract is used to create and handle the stablecoins of Angle protocol
/// @dev It is still possible for any address to burn its agTokens without redeeming collateral in exchange
/// @dev This contract is the upgraded version of the AgToken that was first deployed on Ethereum mainnet
contract AgTokenSideChain is IAgToken, ERC20PermitUpgradeable {

    // ======================= Parameters and Variables ============================

    /// @inheritdoc IAgToken
    mapping(address => bool) public isMinter;
    /// @notice Reference to the treasury contract which can grant minting rights
    ITreasury public treasury;

    // ============================= Constructor ===================================

    /// @notice Initializes the `AgToken` contract
    /// @param name_ Name of the token
    /// @param symbol_ Symbol of the token
    /// @param _treasury Reference to the `Treasury` contract associated to this agToken
    /// @dev By default, agTokens are ERC-20 tokens with 18 decimals
    function initialize(
        string memory name_,
        string memory symbol_,
        ITreasury _treasury
    ) external initializer {
        __ERC20Permit_init(name_);
        __ERC20_init(name_, symbol_);
        require(address(ITreasury(_treasury).stablecoin()) == address(this), "6");
        treasury = ITreasury(_treasury);
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() initializer {}

    // =============================== Added Events ================================

    event TreasuryUpdated(address indexed _treasury);
    event MinterToggled(address indexed minter);

    // =============================== Modifiers ===================================

    /// @notice Checks to see if it is the `StableMaster` calling this contract
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
        treasury = ITreasury(_treasury);
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
