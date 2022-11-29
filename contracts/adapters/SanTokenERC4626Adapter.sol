// SPDX-License-Identifier: BUSL-1.1

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

pragma solidity ^0.8.12;

import "../interfaces/ICoreBorrow.sol";
import "../interfaces/coreModule/ILiquidityGauge.sol";
import "../interfaces/coreModule/IPoolManager.sol";
import "../interfaces/coreModule/IStableMaster.sol";

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/MathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/interfaces/IERC20MetadataUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/interfaces/IERC4626Upgradeable.sol";

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title SanTokenERC4626Adapter
/// @author Angle Labs, Inc.
/// @notice IERC4626 Adapter for SanTokens of the Angle Protocol
abstract contract SanTokenERC4626Adapter is Initializable, ERC20Upgradeable, IERC4626Upgradeable {
    using MathUpgradeable for uint256;
    using SafeERC20 for IERC20;

    // ================================= CONSTANTS =================================

    uint256 internal constant _BASE_PARAMS = 10**9;
    uint256 internal constant _BASE = 10**18;

    // =================================== ERROR ===================================

    error InsufficientAssets();

    uint256[50] private __gap;

    // =============================== INITIALIZATION ==============================

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() initializer {}

    /// @notice Initializes the contract
    function initialize() public initializer {
        __ERC20_init_unchained(
            string(abi.encodePacked("Angle ", sanToken().name(), " Wrapper")),
            string(abi.encodePacked("ag-wrapper-", sanToken().symbol()))
        );
        IERC20(asset()).safeIncreaseAllowance(address(stableMaster()), type(uint256).max);
        if (address(gauge()) != address(0))
            IERC20(address(sanToken())).safeIncreaseAllowance(address(gauge()), type(uint256).max);
    }

    // ============================= VIRTUAL FUNCTIONS =============================

    /// @notice Address of the `StableMaster` in the Core module of the protocol
    function stableMaster() public view virtual returns (IStableMaster);

    /// @notice Address of the corresponding poolManager
    function poolManager() public view virtual returns (address);

    /// @notice Address of the associated sanToken
    function sanToken() public view virtual returns (IERC20MetadataUpgradeable);

    /// @inheritdoc IERC4626Upgradeable
    function asset() public view virtual returns (address);

    /// @inheritdoc IERC4626Upgradeable
    function totalAssets() public view virtual returns (uint256) {
        return _convertToAssetsWithSlippage(sanToken().balanceOf(address(this)));
    }

    /// @notice Returns the gauge address
    /// @dev This function is only useful in the stakable implementation
    function gauge() public view virtual returns (ILiquidityGauge) {
        return ILiquidityGauge(address(0));
    }

    // ========================== IERC4626 VIEW FUNCTIONS ==========================

    /// @inheritdoc IERC20MetadataUpgradeable
    function decimals() public view override(ERC20Upgradeable, IERC20MetadataUpgradeable) returns (uint8) {
        return IERC20MetadataUpgradeable(asset()).decimals();
    }

    /// @notice Returns the available balance of the token in the associated `PoolManager`
    function availableBalance() public view returns (uint256) {
        return IERC20(asset()).balanceOf(poolManager());
    }

    /// @inheritdoc IERC4626Upgradeable
    function convertToShares(uint256 assets) public view returns (uint256 shares) {
        return _convertToShares(assets);
    }

    /// @inheritdoc IERC4626Upgradeable
    function convertToAssets(uint256 shares) public view returns (uint256 assets) {
        return _convertToAssets(shares, MathUpgradeable.Rounding.Down);
    }

    /// @inheritdoc IERC4626Upgradeable
    function maxDeposit(address) public pure returns (uint256) {
        return type(uint256).max;
    }

    /// @inheritdoc IERC4626Upgradeable
    function maxMint(address) public pure returns (uint256) {
        return type(uint256).max;
    }

    /// @inheritdoc IERC4626Upgradeable
    function previewDeposit(uint256 assets) public view returns (uint256) {
        return _convertToShares(assets);
    }

    /// @inheritdoc IERC4626Upgradeable
    function previewMint(uint256 shares) public view returns (uint256) {
        return _convertToAssets(shares, MathUpgradeable.Rounding.Up);
    }

    /// @inheritdoc IERC4626Upgradeable
    function maxWithdraw(address owner) public view returns (uint256) {
        return MathUpgradeable.min(_convertToAssetsWithSlippage(balanceOf(owner)), availableBalance());
    }

    /// @inheritdoc IERC4626Upgradeable
    function maxRedeem(address owner) public view returns (uint256 redeemable) {
        return MathUpgradeable.min(balanceOf(owner), _convertToSharesWithSlippage(availableBalance()));
    }

    /// @inheritdoc IERC4626Upgradeable
    function previewWithdraw(uint256 assets) public view returns (uint256) {
        if (assets > availableBalance()) return type(uint256).max;
        return _convertToSharesWithSlippage(assets);
    }

    /// @inheritdoc IERC4626Upgradeable
    function previewRedeem(uint256 shares) public view returns (uint256) {
        uint256 assets = _convertToAssetsWithSlippage(shares);
        if (assets > availableBalance()) return 0;
        else return assets;
    }

    // ========================= IERC4626 ACTION FUNCTIONS =========================

    /// @inheritdoc IERC4626Upgradeable
    function deposit(uint256 assets, address receiver) public returns (uint256) {
        uint256 shares = previewDeposit(assets);
        _deposit(msg.sender, receiver, assets, shares);
        return shares;
    }

    /// @inheritdoc IERC4626Upgradeable
    function mint(uint256 shares, address receiver) public returns (uint256) {
        uint256 assets = previewMint(shares);
        _deposit(msg.sender, receiver, assets, shares);
        return assets;
    }

    /// @inheritdoc IERC4626Upgradeable
    function withdraw(
        uint256 assets,
        address receiver,
        address owner
    ) public returns (uint256) {
        uint256 shares = previewWithdraw(assets);
        _withdraw(msg.sender, receiver, owner, assets, shares);
        return shares;
    }

    /// @inheritdoc IERC4626Upgradeable
    function redeem(
        uint256 shares,
        address receiver,
        address owner
    ) public returns (uint256) {
        uint256 assets = previewRedeem(shares);
        // This means that there are in fact not enough assets to cover for the shares that are being burnt
        if (assets == 0) revert InsufficientAssets();
        _withdraw(msg.sender, receiver, owner, assets, shares);
        return assets;
    }

    // ============================== INTERNAL HELPERS =============================

    /// @notice Estimates the current version of the sanRate for this collateral asset and the slippage value
    function _estimateSanRate() internal view returns (uint256, uint256) {
        (, , , , , uint256 sanRate, , SLPData memory slpData, ) = stableMaster().collateralMap(poolManager());
        if (block.timestamp != slpData.lastBlockUpdated && slpData.lockedInterests > 0) {
            uint256 sanMint = sanToken().totalSupply();
            if (slpData.lockedInterests > slpData.maxInterestsDistributed) {
                sanRate += (slpData.maxInterestsDistributed * _BASE) / sanMint;
            } else {
                sanRate += (slpData.lockedInterests * _BASE) / sanMint;
            }
        }
        return (sanRate, slpData.slippage);
    }

    /// @notice Deposit/mint common workflow
    function _deposit(
        address caller,
        address receiver,
        uint256 assets,
        uint256 shares
    ) internal {
        IERC20(asset()).safeTransferFrom(caller, address(this), assets);
        stableMaster().deposit(assets, address(this), poolManager());
        _mint(receiver, shares);
        emit Deposit(caller, receiver, assets, shares);
    }

    /// @notice Withdraw/redeem common workflow
    function _withdraw(
        address caller,
        address receiver,
        address owner,
        uint256 assets,
        uint256 shares
    ) internal {
        if (caller != owner) {
            _spendAllowance(owner, caller, shares);
        }
        _burn(owner, shares);
        // Performing two transfers here to be sure that `receiver` exactly receives assets and not
        // `assets+1`
        stableMaster().withdraw(shares, address(this), address(this), poolManager());
        IERC20(asset()).safeTransfer(receiver, assets);
        emit Withdraw(caller, receiver, owner, assets, shares);
    }

    /// @notice Internal version of the `convertToShares` function
    /// @dev We round down by default
    function _convertToShares(uint256 assets) internal view returns (uint256 shares) {
        (uint256 sanRate, ) = _estimateSanRate();
        return assets.mulDiv(_BASE, sanRate, MathUpgradeable.Rounding.Down);
    }

    /// @notice Internal version of the `convertToAssets` function
    function _convertToAssets(uint256 shares, MathUpgradeable.Rounding rounding)
        internal
        view
        returns (uint256 assets)
    {
        (uint256 sanRate, ) = _estimateSanRate();
        return shares.mulDiv(sanRate, _BASE, rounding);
    }

    /// @notice Converts an amount of `assets` to a shares amount with potential exit slippage taken into account
    function _convertToSharesWithSlippage(uint256 assets) internal view returns (uint256 shares) {
        (uint256 sanRate, uint256 slippage) = _estimateSanRate();
        shares = assets.mulDiv(_BASE * _BASE_PARAMS, (_BASE_PARAMS - slippage) * sanRate, MathUpgradeable.Rounding.Up);
    }

    /// @notice Converts an amount of `shares` to an assets amount with potential exit slippage taken into account
    function _convertToAssetsWithSlippage(uint256 shares) internal view returns (uint256 assets) {
        (uint256 sanRate, uint256 slippage) = _estimateSanRate();
        assets = shares.mulDiv(
            (_BASE_PARAMS - slippage) * sanRate,
            _BASE * _BASE_PARAMS,
            MathUpgradeable.Rounding.Down
        );
    }
}
