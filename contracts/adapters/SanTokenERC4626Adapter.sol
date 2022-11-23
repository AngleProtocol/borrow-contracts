// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.8.12;

import "../interfaces/ICoreBorrow.sol";
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
contract SanTokenERC4626Adapter is Initializable, ERC20Upgradeable, IERC4626Upgradeable {
    using MathUpgradeable for uint256;
    using SafeERC20 for IERC20;

    // ================================= CONSTANTS =================================

    uint256 internal constant _BASE_PARAMS = 10**9;
    uint256 internal constant _BASE = 10**18;

    // ================================= REFERENCES ================================

    /// @notice Asset handled by the contract
    IERC20 private _asset;
    /// @notice PoolManager of Angle Core Module associated to the sanToken of the contract
    address public poolManager;
    /// @notice Angle Core Module StableMaster contract
    IStableMaster public stableMaster;

    uint256[47] private __gap;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() initializer {}

    /// @notice Initializes the contract
    function initialize(address _stableMaster, address _poolManager) public initializer returns (address) {
        (address token, address sanToken, , , , , , , ) = IStableMaster(_stableMaster).collateralMap(_poolManager);
        __ERC20_init_unchained(
            string(abi.encodePacked("Angle ", IERC20MetadataUpgradeable(sanToken).name(), " Wrapper")),
            string(abi.encodePacked("ag-wrapper-", IERC20MetadataUpgradeable(sanToken).symbol()))
        );
        poolManager = _poolManager;
        stableMaster = IStableMaster(_stableMaster);
        _asset = IERC20(token);
        IERC20(token).safeIncreaseAllowance(_stableMaster, type(uint256).max);
        return sanToken;
    }

    // ========================== IERC4626 VIEW FUNCTIONS ==========================

    /// @inheritdoc IERC4626Upgradeable
    function asset() public view returns (address) {
        return address(_asset);
    }

    /// @inheritdoc IERC4626Upgradeable
    /// @dev In this case the `totalAssets` function is not used to compute the share price
    function totalAssets() public view returns (uint256) {
        return IERC20(asset()).balanceOf(poolManager);
    }

    /// @inheritdoc IERC4626Upgradeable
    function convertToShares(uint256 assets) public view returns (uint256 shares) {
        return _convertToShares(assets, MathUpgradeable.Rounding.Down);
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
        return _convertToShares(assets, MathUpgradeable.Rounding.Down);
    }

    /// @inheritdoc IERC4626Upgradeable
    function previewMint(uint256 shares) public view returns (uint256) {
        return _convertToAssets(shares, MathUpgradeable.Rounding.Up);
    }

    /// @inheritdoc IERC4626Upgradeable
    function maxWithdraw(address owner) public view returns (uint256) {
        return MathUpgradeable.min(previewRedeem(balanceOf(owner)), totalAssets());
    }

    /// @inheritdoc IERC4626Upgradeable
    /// @dev This function returns an underestimate of the amount of shares that can be redeemed. If there is a slippage
    /// you can effectively burn more shares to receive `totalAssets()`, and slippage is not taken into account in the
    /// `_convertToShares` function
    function maxRedeem(address owner) public view returns (uint256 redeemable) {
        return MathUpgradeable.min(balanceOf(owner), _convertToShares(totalAssets(), MathUpgradeable.Rounding.Down));
    }

    /// @inheritdoc IERC4626Upgradeable
    function previewWithdraw(uint256 assets) public view returns (uint256) {
        if (assets > totalAssets()) return type(uint256).max;
        (uint256 sanRate, uint256 slippage) = _estimateSanRate();
        return assets.mulDiv(_BASE * _BASE_PARAMS, (_BASE_PARAMS - slippage) * sanRate, MathUpgradeable.Rounding.Up);
    }

    /// @inheritdoc IERC4626Upgradeable
    function previewRedeem(uint256 shares) public view returns (uint256) {
        (uint256 sanRate, uint256 slippage) = _estimateSanRate();
        uint256 assets = shares.mulDiv(
            (_BASE_PARAMS - slippage) * sanRate,
            _BASE * _BASE_PARAMS,
            MathUpgradeable.Rounding.Down
        );
        if (assets > totalAssets()) return 0;
        else return assets;
    }

    // ========================= IERC4626 ACTION FUNCTIONS =========================

    /// @inheritdoc IERC4626Upgradeable
    function deposit(uint256 assets, address receiver) public returns (uint256) {
        uint256 shares = previewDeposit(assets);
        _deposit(_msgSender(), receiver, assets, shares);
        return shares;
    }

    /// @inheritdoc IERC4626Upgradeable
    function mint(uint256 shares, address receiver) public returns (uint256) {
        uint256 assets = previewMint(shares);
        _deposit(_msgSender(), receiver, assets, shares);

        return assets;
    }

    /// @inheritdoc IERC4626Upgradeable
    function withdraw(
        uint256 assets,
        address receiver,
        address owner
    ) public returns (uint256) {
        uint256 shares = previewWithdraw(assets);
        _withdraw(_msgSender(), receiver, owner, assets, shares);
        return shares;
    }

    /// @inheritdoc IERC4626Upgradeable
    function redeem(
        uint256 shares,
        address receiver,
        address owner
    ) public returns (uint256) {
        uint256 assets = previewRedeem(shares);
        _withdraw(_msgSender(), receiver, owner, assets, shares);
        return assets;
    }

    // ============================== INTERNAL HELPERS =============================

    /// @notice Estimates the current version of the sanRate for this collateral asset and the slippage value
    function _estimateSanRate() internal view returns (uint256, uint256) {
        (, address sanToken, , , , uint256 sanRate, , SLPData memory slpData, ) = stableMaster.collateralMap(
            poolManager
        );
        if (block.timestamp != slpData.lastBlockUpdated && slpData.lockedInterests > 0) {
            uint256 sanMint = IERC20(sanToken).totalSupply();
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
        stableMaster.deposit(assets, address(this), poolManager);
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
        stableMaster.withdraw(shares, address(this), receiver, poolManager);
        IERC20(asset()).safeTransfer(receiver, assets);
        emit Withdraw(caller, receiver, owner, assets, shares);
    }

    /// @notice Internal version of the `convertToShares` function
    function _convertToShares(uint256 assets, MathUpgradeable.Rounding rounding)
        internal
        view
        returns (uint256 shares)
    {
        (uint256 sanRate, ) = _estimateSanRate();
        return assets.mulDiv(_BASE, sanRate, rounding);
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
}
