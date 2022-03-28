// SPDX-License-Identifier: AGPL-3.0-only

pragma solidity 0.8.12;

import "../interfaces/IEulerMarket.sol";

import "./BaseReactor.sol";

/// @title EulerReactor
/// @notice Reactor to mint agEUR and deposit them on Euler Finance (https://www.euler.finance/)
/// @notice Euler markets only work with token with decimal <= 18
/// @author Angle Core Team
contract EulerReactor is BaseReactor {
    using SafeERC20 for IERC20;

    IEulerEToken public euler;
    uint256 public lastBalance;
    uint256 public minInvest;

    /// @notice Initializes the `BaseReactor` contract and
    /// the underlying `VaultManager`
    /// @param _name Name of the ERC4626 token
    /// @param _symbol Symbol of the ERC4626 token
    /// @param _vaultManager Underlying `VaultManager` used to borrow stablecoin
    /// @param _lowerCF Lower Collateral Factor accepted without rebalancing
    /// @param _targetCF Target Collateral Factor
    /// @param _upperCF Upper Collateral Factor accepted without rebalancing
    function initialize(
        IEulerEToken _euler,
        uint256 minInvest_,
        string memory _name,
        string memory _symbol,
        IVaultManager _vaultManager,
        uint64 _lowerCF,
        uint64 _targetCF,
        uint64 _upperCF
    ) external {
        euler = _euler;
        minInvest = minInvest_;
        _initialize(_name, _symbol, _vaultManager, _lowerCF, _targetCF, _upperCF);
    }

    /// @inheritdoc IERC4626
    /// @dev Users are limited in the amount to be withdrawn by liquidity on Euler contracts
    function maxWithdraw(address user) public view virtual override returns (uint256) {
        uint256 toWithdraw = convertToAssets(balanceOf(user));
        (uint256 usedAssets, uint256 looseAssets) = _getAssets();
        if (toWithdraw <= looseAssets) return toWithdraw;
        else return looseAssets + _maxStablecoinsAvailable(toWithdraw, usedAssets, looseAssets);
    }

    /// @inheritdoc IERC4626
    /// @dev Users are limited in the amount to be withdrawn by liquidity on Euler contracts
    function maxRedeem(address user) public view virtual override returns (uint256) {
        uint256 maxAmountToRedeem;
        uint256 toWithdraw = convertToAssets(balanceOf(user));
        (uint256 usedAssets, uint256 looseAssets) = _getAssets();
        if (toWithdraw <= looseAssets) maxAmountToRedeem = toWithdraw;
        else maxAmountToRedeem = _maxStablecoinsAvailable(toWithdraw, usedAssets, looseAssets);
        return convertToShares(looseAssets + maxAmountToRedeem);
    }

    function setMinInvest(uint256 minInvest_) public onlyGovernorOrGuardian {
        minInvest = minInvest_;
    }

    /// @notice Changes allowance of this contract for a given token
    /// @param amount Amount allowed
    function changeAllowance(uint256 amount) external onlyGovernorOrGuardian {
        uint256 currentAllowance = IERC20(address(stablecoin)).allowance(address(this), address(euler));
        if (currentAllowance < amount) {
            IERC20(address(stablecoin)).safeIncreaseAllowance(address(euler), amount - currentAllowance);
        } else if (currentAllowance > amount) {
            IERC20(address(stablecoin)).safeDecreaseAllowance(address(euler), currentAllowance - amount);
        }
    }

    /// @notice Returns the maximum amount of assets that can be withdrawn considering current Euler liquidity
    /// @param amount Amount of assets wanted to be withdrawn
    /// @param usedAssets Amount of assets collateralizing the vault
    /// @param looseAssets Amount of assets directly accessible -- in the contract balance
    /// @dev Users are limited in the amount to be withdrawn by liquidity on Euler contracts
    function _maxStablecoinsAvailable(
        uint256 amount,
        uint256 usedAssets,
        uint256 looseAssets
    ) internal view returns (uint256 maxAmount) {
        uint256 toWithdraw = amount - looseAssets;
        uint256 oracleRate = oracle.read();

        uint256 debt = vaultManager.getVaultDebt(vaultID);
        (uint256 futureStablecoinsInVault, uint256 collateralFactor) = _getFutureDebtAndCF(
            toWithdraw,
            usedAssets,
            looseAssets,
            debt,
            oracleRate
        );

        uint256 stablecoinsValueToRedeem;
        if (collateralFactor >= upperCF) {
            // If the `collateralFactor` is too high, then too much has been borrowed
            // and stablecoins should be repaid
            stablecoinsValueToRedeem = debt - futureStablecoinsInVault;
            if (futureStablecoinsInVault <= vaultManagerDust) {
                // If this happens in a moment at which the reactor has a loss, then it will not be able
                // to repay it all, and the function will revert
                stablecoinsValueToRedeem = type(uint256).max;
            }
            // Liquidity on Euler
            uint256 poolSize = stablecoin.balanceOf(address(euler));
            uint256 reactorBalanceEuler = euler.balanceOfUnderlying(address(this));
            uint256 maxEulerWithdrawal = poolSize > reactorBalanceEuler ? reactorBalanceEuler : poolSize;
            // if we can fully reimburse with Euler liquidity then users can withdraw hiw whole balance
            if (maxEulerWithdrawal < stablecoinsValueToRedeem) {
                stablecoinsValueToRedeem = maxEulerWithdrawal;
                maxAmount = (stablecoinsValueToRedeem * _assetBase * BASE_PARAMS) / (oracleRate * targetCF);
                maxAmount = maxAmount > toWithdraw ? toWithdraw : maxAmount;
            } else {
                maxAmount = toWithdraw;
            }
        } else {
            maxAmount = toWithdraw;
        }
    }

    /// @notice Virtual function to invest stablecoins
    /// @param amount Amount of new stablecoins managed
    /// @return amountInvested Amount invested in the strategy
    /// @dev Calling this function should eventually trigger something regarding strategies depending
    /// on a threshold
    /// @dev Amount should not be above maxExternalAmount defined in Euler otherwise it will revert
    function _push(uint256 amount) internal virtual override returns (uint256 amountInvested) {
        (uint256 lentStablecoins, uint256 looseStablecoins) = _report(amount);

        if (looseStablecoins > minInvest) {
            euler.deposit(0, looseStablecoins);
            // as looseStablecoins should be null
            lastBalance = euler.balanceOfUnderlying(address(this));
        } else {
            lastBalance = lentStablecoins + looseStablecoins;
        }
        return amount;
    }

    /// @notice Virtual function to withdraw stablecoins
    /// @param amount Amount needed at the end of the call
    /// @return amountAvailable Amount available in the contracts, it's like a new `looseAssets` value
    /// @dev The call will revert if `stablecoin.balanceOf(address(euler))<amount`
    function _pull(uint256 amount) internal virtual override returns (uint256 amountAvailable) {
        (uint256 lentStablecoins, uint256 looseStablecoins) = _report(0);

        console.log("_pull - lentStablecoins ", lentStablecoins);
        console.log("_pull - looseStablecoins ", looseStablecoins);
        console.log("_pull - amount ", amount);
        console.log("_pull - before lastBalance ", lastBalance);

        if (looseStablecoins < amount) {
            euler.withdraw(0, amount - looseStablecoins);
            lastBalance = euler.balanceOfUnderlying(address(this));
        } else {
            lastBalance = lentStablecoins + looseStablecoins - amount;
        }
        console.log("_pull - after lastBalance ", lastBalance);

        return amount;
    }

    function _report(uint256 amountToAdd) internal returns (uint256 lentStablecoins, uint256 looseStablecoins) {
        lentStablecoins = euler.balanceOfUnderlying(address(this));
        looseStablecoins = stablecoin.balanceOf(address(this));
        console.log("report - lastBalance ", lastBalance);
        console.log("report - looseAssets ", looseStablecoins);
        console.log("report - lentAssets ", lentStablecoins);
        console.log("report - amountToAdd ", amountToAdd);

        // always positive otherwise we couldn't do the operation
        uint256 total = looseStablecoins + lentStablecoins - amountToAdd;

        console.log("report - total ", total);

        if (total > lastBalance) _handleGain(total - lastBalance);
        else _handleLoss(lastBalance - total);

        console.log("report - claimableRewards ", claimableRewards);
        console.log("report - currentLoss ", currentLoss);
    }
}
