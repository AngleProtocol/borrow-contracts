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
    ) VaultManagerLiquidationBoost() {
        if (_oracle.treasury() != _treasury) revert InvalidTreasury();
        treasury = _treasury;
        collateral = _collateral;
        _collatBase = 10**(IERC20Metadata(address(collateral)).decimals());
        stablecoin = IAgToken(_treasury.stablecoin());
        oracle = _oracle;
        string memory _name = string.concat("Angle Protocol ", _symbol, " Vault");
        name = _name;
        __ERC721Permit_init(_name);
        symbol = string.concat(_symbol, "-vault");

        interestAccumulator = BASE_INTEREST;
        lastInterestAccumulatorUpdated = block.timestamp;

        // Checking if the parameters have been correctly initialized
        if (
            params.collateralFactor > params.liquidationSurcharge ||
            params.liquidationSurcharge > BASE_PARAMS ||
            BASE_PARAMS > params.targetHealthFactor ||
            params.maxLiquidationDiscount >= BASE_PARAMS ||
            params.baseBoost == 0
        ) revert InvalidSetOfParameters();

        debtCeiling = params.debtCeiling;
        collateralFactor = params.collateralFactor;
        targetHealthFactor = params.targetHealthFactor;
        interestRate = params.interestRate;
        liquidationSurcharge = params.liquidationSurcharge;
        maxLiquidationDiscount = params.maxLiquidationDiscount;
        whitelistingActivated = params.whitelistingActivated;
        yLiquidationBoost = [params.baseBoost];
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
    function _whitelistingActivated() internal pure override returns (bool) {
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
    function togglePause() external override {}

    /// @inheritdoc VaultManager
    function toggleWhitelist(address target) external override {}

    /// @inheritdoc VaultManager
    function setOracle(address _oracle) external override {}

    /// @inheritdoc VaultManager
    function setTreasury(address _treasury) external override {}
}
