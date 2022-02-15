// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.10;

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
contract AgToken is IAgToken, ERC20PermitUpgradeable {
    // ========================= References to other contracts =====================

    /// @inheritdoc IAgToken
    address public override stableMaster;

    // ============================= Constructor ===================================

    /// @notice Initializes the `AgToken` contract
    /// @param name_ Name of the token
    /// @param symbol_ Symbol of the token
    /// @param stableMaster_ Reference to the `StableMaster` contract associated to this agToken
    /// @dev By default, agTokens are ERC-20 tokens with 18 decimals
    function initialize(
        string memory name_,
        string memory symbol_,
        address stableMaster_
    ) external initializer {
        __ERC20Permit_init(name_);
        __ERC20_init(name_, symbol_);
        require(stableMaster_ != address(0), "0");
        stableMaster = stableMaster_;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() initializer {}

    // ======= Added Parameters and Variables from the first implementation ========

    /// @inheritdoc IAgToken
    mapping(address => bool) public override isMinter;
    /// @notice Reference to the treasury contract which can grant minting rights
    ITreasury public treasury;
    /// @notice Boolean to check whether the contract has been reinitialized after its upgrade
    bool public treasuryInitialized;

    // =============================== Added Events ================================

    event TreasuryUpdated(address indexed _treasury);
    event MinterToggled(address indexed minter);

    // =============================== Setup Function ==============================

    /// @notice Sets up the treasury contract in this AgToken contract
    /// @param _treasury Treasury contract to add
    /// @dev The address calling this function has to be hard-coded in the contract
    function setUpTreasury(address _treasury) external {
        require(msg.sender == 0xdC4e6DFe07EFCa50a197DF15D9200883eF4Eb1c8);
        require(address(ITreasury(_treasury).stablecoin()) == address(this));
        require(!treasuryInitialized);
        treasury = ITreasury(_treasury);
        treasuryInitialized = true;
        emit TreasuryUpdated(_treasury);
    }

    // =============================== Modifiers ===================================

    /// @notice Checks to see if it is the `StableMaster` calling this contract
    /// @dev There is no Access Control here, because it can be handled cheaply through this modifier
    modifier onlyTreasury() {
        require(msg.sender == address(treasury), "1");
        _;
    }

    /// @notice Checks whether the sender has the minting right
    modifier onlyMinter() {
        require(msg.sender == stableMaster || isMinter[msg.sender]);
        _;
    }

    // ========================= External Functions ================================
    // The following functions allow anyone to burn stablecoins without redeeming collateral
    // in exchange for that

    /// @notice Destroys `amount` token from the caller without giving collateral back
    /// @param amount Amount to burn
    /// @param poolManager Reference to the `PoolManager` contract for which the `stocksUsers` will
    /// need to be updated
    /// @dev When calling this function, people should specify the `poolManager` for which they want to decrease
    /// the `stocksUsers`: this a way for the protocol to maintain healthy accounting variables
    function burnNoRedeem(uint256 amount, address poolManager) external {
        _burn(msg.sender, amount);
        IStableMaster(stableMaster).updateStocksUsers(amount, poolManager);
    }

    /// @notice Burns `amount` of agToken on behalf of another account without redeeming collateral back
    /// @param account Account to burn on behalf of
    /// @param amount Amount to burn
    /// @param poolManager Reference to the `PoolManager` contract for which the `stocksUsers` will need to be updated
    function burnFromNoRedeem(
        address account,
        uint256 amount,
        address poolManager
    ) external {
        _burnFromNoRedeem(amount, account, msg.sender);
        IStableMaster(stableMaster).updateStocksUsers(amount, poolManager);
    }

    /// @notice Allows anyone to burn agToken without redeeming collateral back
    /// @param amount Amount of stablecoins to burn
    /// @dev This function can typically be called if there
    function burnStablecoin(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    // ======================= Minter Role Only Functions ==========================

    /// @inheritdoc IAgToken
    function burnSelf(uint256 amount, address burner) external override onlyMinter {
        _burn(burner, amount);
    }

    /// @inheritdoc IAgToken
    function burnFrom(
        uint256 amount,
        address burner,
        address sender
    ) external override onlyMinter {
        _burnFromNoRedeem(amount, burner, sender);
    }

    /// @inheritdoc IAgToken
    function mint(address account, uint256 amount) external override onlyMinter {
        _mint(account, amount);
    }

    // ======================= Treasury Only Functions =============================

    /// @inheritdoc IAgToken
    function addMinter(address minter) external override onlyTreasury {
        require(minter != address(0));
        isMinter[minter] = true;
        emit MinterToggled(minter);
    }

    /// @inheritdoc IAgToken
    function removeMinter(address minter) external override {
        require(msg.sender == address(treasury) || msg.sender == minter);
        isMinter[minter] = false;
        emit MinterToggled(minter);
    }

    /// @inheritdoc IAgToken
    function setTreasury(address _treasury) external override onlyTreasury {
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
        uint256 currentAllowance = allowance(burner, sender);
        require(currentAllowance >= amount, "23");
        _approve(burner, sender, currentAllowance - amount);
        _burn(burner, amount);
    }
}
