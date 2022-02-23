// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.10;

import "./ITreasury.sol";

// ========================= Key Structs and Enums =============================

/// @notice Parameters associated to a given `VaultManager` contract: these all correspond
/// to parameters which signification is detailed below
struct VaultParameters {
    uint256 dust;
    uint256 dustCollateral;
    uint256 debtCeiling;
    uint64 collateralFactor;
    uint64 targetHealthFactor;
    uint64 borrowFee;
    uint64 interestRate;
    uint64 liquidationSurcharge;
    uint64 maxLiquidationDiscount;
    uint64 liquidationBooster;
    bool whitelistingActivated;
}

/// @notice Data stored to track someone's loan (or equivalently called position)
struct Vault {
    // Amount of collateral deposited in the vault
    uint256 collateralAmount;
    // Normalized value of the debt (that is to say of the stablecoins borrowed)
    uint256 normalizedDebt;
}

/// @notice For a given `vaultID`, this encodes a liquidation opportunity that is to say details about the maximum
/// amount that could be repaid by liquidating the position
/// @dev All the values are null in the case of a vault which cannot be liquidated under these conditions
struct LiquidationOpportunity {
    // Maximum stablecoin amount that can be repaid upon liquidating the vault
    uint256 maxStablecoinAmountToRepay;
    // Collateral amount given to the person in the case where the maximum amount to repay is given
    uint256 maxCollateralAmountGiven;
    // Threshold value of stablecoin amount to repay: it is ok for a liquidator to repay below threshold,
    // but if this threshold is non null and the liquidator wants to repay more than threshold, it should repay
    // the max stablecoin amount given in this vault
    uint256 thresholdRepayAmount;
    // Discount proposed to the liquidator on the collateral
    uint256 discount;
    // Amount of debt in the vault
    uint256 currentDebt;
}

/// @notice Data stored during a liquidation process to keep in memory what's due to a liquidator and some
/// essential data for vaults being liquidated
struct LiquidatorData {
    // Current amount of stablecoins the liquidator should give to the contract
    uint256 stablecoinAmountToReceive;
    // Current amount of collateral the contract should give to the liquidator
    uint256 collateralAmountToGive;
    // Bad debt accrued across the liquidation process
    uint256 badDebtFromLiquidation;
    // Oracle value (in stablecoin base) at the time of the liquidation
    uint256 oracleValue;
    // Value of the interestRateAccumulator at the time of the call
    uint256 newInterestRateAccumulator;
}

/// @notice Data to track during a series of action the amount to give or receive in stablecoins and collateral
/// to the caller or associated addresses
struct PaymentData {
    // Stablecoin amount the contract should give
    uint256 stablecoinAmountToGive;
    // Stablecoin amount owed to the contract
    uint256 stablecoinAmountToReceive;
    // Collateral amount the contract should give
    uint256 collateralAmountToGive;
    // Collateral amount owed to the contract
    uint256 collateralAmountToReceive;
}

/// @notice Actions possible when composing calls to the different entry functions proposed
enum ActionType {
    createVault,
    closeVault,
    addCollateral,
    removeCollateral,
    repayDebt,
    borrow,
    getDebtIn
}

// ========================= Interfaces =============================

/// @title IVaultManagerFunctions
/// @author Angle Core Team
/// @notice Interface for the `VaultManager` contract
/// @dev This interface only contains functions of the contract which are called by other contracts
/// of this module (without getters)
interface IVaultManagerFunctions {
    /// @notice Accrues interest accumulated across all vaults to the surplus and sends the surplus to the treasury
    /// @return surplusValue Value of the surplus communicated to the `Treasury`
    /// @return badDebtValue Value of the bad debt communicated to the `Treasury`
    /// @dev `surplus` and `badDebt` should be reset to 0 once their current value have been given to the `treasury` contract
    function accrueInterestToTreasury() external returns (uint256 surplusValue, uint256 badDebtValue);

    /// @notice Removes debt from a vault after being requested to do so by another `vaultManager` contract
    /// @param vaultID ID of the vault to remove debt from
    /// @param amountStablecoins Amount of stablecoins to remove from the debt: this amount is to be converted to an
    /// internal debt amount
    /// @param senderBorrowFee Borrowing fees from the contract which requested this: this is to make sure that people are not
    /// arbitraging difference in minting fees
    function getDebtOut(
        uint256 vaultID,
        uint256 amountStablecoins,
        uint256 senderBorrowFee
    ) external;

    /// @notice Sets the treasury contract
    /// @param _treasury New treasury contract
    /// @dev All required checks when setting up a treasury contract are performed in the contract
    /// calling this function
    function setTreasury(address _treasury) external;
}

/// @title IVaultManagerStorage
/// @author Angle Core Team
/// @notice Interface for the `VaultManager` contract
/// @dev This interface only contains getters of the contract which are called by other contracts
/// of this module
interface IVaultManagerStorage {
    /// @notice Reference to the `treasury` contract handling this `VaultManager`
    function treasury() external view returns (ITreasury);
}

/// @title IVaultManager
/// @author Angle Core Team
/// @notice Interface for the `VaultManager` contract
/// @dev This interface only contains functions of the contract which are called by other contracts
/// of this module
interface IVaultManager is IVaultManagerFunctions, IVaultManagerStorage {
    function angle(
        ActionType[] memory actions,
        bytes[] memory datas,
        address from,
        address to
    ) external payable;

    function angle(
        ActionType[] memory actions,
        bytes[] memory datas,
        address from,
        address to,
        address who,
        bytes calldata repayData
    ) external payable;
}
