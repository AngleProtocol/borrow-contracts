// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.17;

import "./VaultManagerLiquidationBoost.sol";

/// @title VaultManagerLiquidationBoost
/// @author Angle Labs, Inc.
/// @notice Immutable VaultManagerLiquidationBoost
contract VaultManagerLiquidationBoostImmutable is VaultManagerLiquidationBoost {
    constructor(
        ITreasury _treasury,
        IERC20 _collateral,
        IOracle _oracle,
        VaultParameters memory params,
        string memory _symbol
    ) VaultManagerLiquidationBoost() initializer {
        _initialize(_treasury, _collateral, _oracle, params, _symbol);
    }

    /// @inheritdoc VaultManager
    function setUint64(uint64 param, bytes32 what) external override onlyGovernorOrGuardian {
        if (what == "CF") {
            if (param > liquidationSurcharge) revert TooHighParameterValue();
            collateralFactor = param;
        } else if (what == "THF") {
            if (param < BASE_PARAMS) revert TooSmallParameterValue();
            targetHealthFactor = param;
        } else if (what == "BF") {
            if (param > BASE_PARAMS) revert TooHighParameterValue();
            borrowFee = param;
        } else if (what == "IR") {
            _accrue();
            interestRate = param;
        } else if (what == "MLD") {
            if (param > BASE_PARAMS) revert TooHighParameterValue();
            maxLiquidationDiscount = param;
        } else {
            revert InvalidParameterType();
        }
        emit FiledUint64(param, what);
    }

    /// @inheritdoc VaultManagerERC721
<<<<<<< HEAD
    function _whitelistingActivated() internal pure virtual override returns (bool) {
=======
    function _whitelistingActivated() internal pure override returns (bool) {
>>>>>>> 974c695 (first draft immutable borrow contracts)
        return false;
    }

    /// @inheritdoc VaultManager
    function _paused() internal pure override returns (bool) {
        return false;
    }

    /// @inheritdoc VaultManager
    function _repayFee() internal pure override returns (uint64) {
        return 0;
    }

    /// @inheritdoc VaultManager
<<<<<<< HEAD
    function initialize(
        ITreasury _treasury,
        IERC20 _collateral,
        IOracle _oracle,
        VaultParameters calldata params,
        string memory _symbol
    ) external override {}

    /// @inheritdoc VaultManager
=======
>>>>>>> 974c695 (first draft immutable borrow contracts)
    function togglePause() external override {}

    /// @inheritdoc VaultManager
    function toggleWhitelist(address target) external override {}

    /// @inheritdoc VaultManager
    function setOracle(address _oracle) external override {}

    /// @inheritdoc VaultManager
    function setTreasury(address _treasury) external override {}
}
