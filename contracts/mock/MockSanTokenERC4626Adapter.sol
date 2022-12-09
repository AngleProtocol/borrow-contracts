// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.17;

import "../adapters/SanTokenERC4626Adapter.sol";
import { SanTokenERC4626AdapterStakable } from "../adapters/SanTokenERC4626AdapterStakable.sol";

contract MockSanTokenERC4626Adapter is SanTokenERC4626Adapter {
    IStableMaster internal _stableMaster;
    address internal _poolManager;
    IERC20MetadataUpgradeable internal _sanToken;
    address internal _asset;

    /// @notice Address of the `StableMaster` in the Core module of the protocol
    function stableMaster() public view override returns (IStableMaster) {
        return _stableMaster;
    }

    /// @notice Address of the corresponding poolManager
    function poolManager() public view override returns (address) {
        return _poolManager;
    }

    /// @notice Address of the associated sanToken
    function sanToken() public view override returns (IERC20MetadataUpgradeable) {
        return _sanToken;
    }

    /// @inheritdoc IERC4626Upgradeable
    function asset() public view override returns (address) {
        return _asset;
    }

    // ================================== SETTERS ==================================

    /// @notice Address of the `StableMaster` in the Core module of the protocol
    function setStableMaster(address stableMaster_) public virtual {
        _stableMaster = IStableMaster(stableMaster_);
    }

    /// @notice Address of the corresponding poolManager
    function setPoolManager(address poolManager_) public virtual {
        _poolManager = poolManager_;
    }

    /// @notice Address of the associated sanToken
    function setSanToken(address sanToken_) public virtual {
        _sanToken = IERC20MetadataUpgradeable(sanToken_);
    }

    function setAsset(address asset_) public virtual {
        _asset = asset_;
    }
}

contract MockSanTokenERC4626AdapterStakable is SanTokenERC4626AdapterStakable {
    ILiquidityGauge internal _gauge;
    IStableMaster internal _stableMaster;
    address internal _poolManager;
    IERC20MetadataUpgradeable internal _sanToken;
    address internal _asset;

    /// @notice Address of the `StableMaster` in the Core module of the protocol
    function stableMaster() public view override returns (IStableMaster) {
        return _stableMaster;
    }

    /// @notice Address of the corresponding poolManager
    function poolManager() public view override returns (address) {
        return _poolManager;
    }

    /// @notice Address of the associated sanToken
    function sanToken() public view override returns (IERC20MetadataUpgradeable) {
        return _sanToken;
    }

    /// @inheritdoc IERC4626Upgradeable
    function asset() public view override returns (address) {
        return _asset;
    }

    // ================================== SETTERS ==================================

    /// @notice Address of the `StableMaster` in the Core module of the protocol
    function setStableMaster(address stableMaster_) public virtual {
        _stableMaster = IStableMaster(stableMaster_);
    }

    /// @notice Address of the corresponding poolManager
    function setPoolManager(address poolManager_) public virtual {
        _poolManager = poolManager_;
    }

    /// @notice Address of the associated sanToken
    function setSanToken(address sanToken_) public virtual {
        _sanToken = IERC20MetadataUpgradeable(sanToken_);
    }

    function setAsset(address asset_) public virtual {
        _asset = asset_;
    }

    /// @notice Address of the corresponding poolManager
    function gauge() public view override returns (ILiquidityGauge) {
        return _gauge;
    }

    function setLiquidityGauge(address gauge_) public virtual {
        _gauge = ILiquidityGauge(gauge_);
    }
}
