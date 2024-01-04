// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

/*
                  *                                                  █                              
                *****                                               ▓▓▓                             
                  *                                               ▓▓▓▓▓▓▓                         
                                   *            ///.           ▓▓▓▓▓▓▓▓▓▓▓▓▓                       
                                 *****        ////////            ▓▓▓▓▓▓▓                          
                                   *       /////////////            ▓▓▓                             
                     ▓▓                  //////////////////          █         ▓▓                   
                   ▓▓  ▓▓             ///////////////////////                ▓▓   ▓▓                
                ▓▓       ▓▓        ////////////////////////////           ▓▓        ▓▓              
              ▓▓            ▓▓    /////////▓▓▓///////▓▓▓/////////       ▓▓             ▓▓            
           ▓▓                 ,////////////////////////////////////// ▓▓                 ▓▓         
        ▓▓                  //////////////////////////////////////////                     ▓▓      
      ▓▓                  //////////////////////▓▓▓▓/////////////////////                          
                       ,////////////////////////////////////////////////////                        
                    .//////////////////////////////////////////////////////////                     
                     .//////////////////////////██.,//////////////////////////█                     
                       .//////////////////////████..,./////////////////////██                       
                        ...////////////////███████.....,.////////////////███                        
                          ,.,////////////████████ ........,///////////████                          
                            .,.,//////█████████      ,.......///////████                            
                               ,..//████████           ........./████                               
                                 ..,██████                .....,███                                 
                                    .██                     ,.,█                                    
                                                                                                    
                                                                                                    
                                                                                                    
               ▓▓            ▓▓▓▓▓▓▓▓▓▓       ▓▓▓▓▓▓▓▓▓▓        ▓▓               ▓▓▓▓▓▓▓▓▓▓          
             ▓▓▓▓▓▓          ▓▓▓    ▓▓▓       ▓▓▓               ▓▓               ▓▓   ▓▓▓▓         
           ▓▓▓    ▓▓▓        ▓▓▓    ▓▓▓       ▓▓▓    ▓▓▓        ▓▓               ▓▓▓▓▓             
          ▓▓▓        ▓▓      ▓▓▓    ▓▓▓       ▓▓▓▓▓▓▓▓▓▓        ▓▓▓▓▓▓▓▓▓▓       ▓▓▓▓▓▓▓▓▓▓          
*/

import "../interfaces/IAgToken.sol";
import "../interfaces/ITreasury.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/draft-ERC20PermitUpgradeable.sol";

/// @title AgToken
/// @author Angle Labs, Inc.
/// @notice Base contract for Angle agTokens on Ethereum and on other chains
/// @dev By default, agTokens are ERC-20 tokens with 18 decimals
contract AgToken is IAgToken, ERC20PermitUpgradeable {
    // =========================== PARAMETERS / VARIABLES ==========================

    /// @inheritdoc IAgToken
    mapping(address => bool) public isMinter;
    /// @notice Reference to the treasury contract which can grant minting rights
    address public treasury;

    // =================================== EVENTS ==================================

    event TreasuryUpdated(address indexed _treasury);
    event MinterToggled(address indexed minter);

    // =================================== ERRORS ==================================

    error BurnAmountExceedsAllowance();
    error InvalidSender();
    error InvalidTreasury();
    error NotMinter();
    error NotTreasury();

    // ================================ CONSTRUCTOR ================================

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() initializer {}

    /// @notice Initializes the `AgToken` contract
    function initialize(string memory name_, string memory symbol_, address _treasury) external {
        _initialize(name_, symbol_, _treasury);
    }

    /// @notice Initializes the contract
    function _initialize(string memory name_, string memory symbol_, address _treasury) internal virtual initializer {
        if (address(ITreasury(_treasury).stablecoin()) != address(this)) revert InvalidTreasury();
        __ERC20Permit_init(name_);
        __ERC20_init(name_, symbol_);
        treasury = _treasury;
        emit TreasuryUpdated(_treasury);
    }

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

    // ========================== GOVERNANCE ONLY FUNCTIONS ==========================

    /// @inheritdoc IAgToken
    function addMinter(address minter) external onlyTreasury {
        isMinter[minter] = true;
        emit MinterToggled(minter);
    }

    /// @inheritdoc IAgToken
    function removeMinter(address minter) external {
        if (msg.sender != address(treasury) && msg.sender != minter) revert InvalidSender();
        isMinter[minter] = false;
        emit MinterToggled(minter);
    }

    /// @inheritdoc IAgToken
    function setTreasury(address _treasury) external virtual onlyTreasury {
        treasury = _treasury;
        emit TreasuryUpdated(_treasury);
    }
}
