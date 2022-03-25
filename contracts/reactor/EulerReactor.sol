// SPDX-License-Identifier: AGPL-3.0-only

pragma solidity 0.8.12;

import "../interfaces/IEulerMarket.sol";

import "./BaseReactor.sol";

/// @title EulerReactor
/// @notice Reactor to mint agEUR and deposit them on Euler Finance (https://www.euler.finance/)
/// @author Angle Core Team
contract EulerReactor is BaseReactor {
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
        string memory _name,
        string memory _symbol,
        IVaultManager _vaultManager,
        uint64 _lowerCF,
        uint64 _targetCF,
        uint64 _upperCF
    ) external {
        euler = _euler;
        _initialize(_name, _symbol, _vaultManager, _lowerCF, _targetCF, _upperCF);
    }

    /// @inheritdoc IERC4626
    /// @dev Users are limited in the amount to be withdrawn by liquidity on Euler contracts
    function maxWithdraw(address user) public view virtual override returns (uint256) {
        uint256 toWithdraw = convertToAssets(balanceOf(user));
        (, uint256 looseAssets) = _getAssets();
        if (toWithdraw <= looseAssets) return toWithdraw;
        else return _maxStablecoinsAvailable(toWithdraw - looseAssets);
    }

    /// @inheritdoc IERC4626
    /// @dev Users are limited in the amount to be withdrawn by liquidity on Euler contracts
    function maxRedeem(address user) public view virtual override returns (uint256) {
        uint256 maxAmountToRedeem;
        uint256 toWithdraw = convertToAssets(balanceOf(user));
        (, uint256 looseAssets) = _getAssets();
        if (toWithdraw <= looseAssets) maxAmountToRedeem = toWithdraw;
        else maxAmountToRedeem = _maxStablecoinsAvailable(toWithdraw - looseAssets);
        return convertToShares(maxAmountToRedeem);
    }

    /// @notice Returns the maximum amount of assets that can be withdrawn considering current Euler liquidity
    /// @param amount Amount of assets wanted to be withdrawn
    /// @dev Users are limited in the amount to be withdrawn by liquidity on Euler contracts
    function _maxStablecoinsAvailable(uint256 amount) internal view returns (uint256 maxAmount) {
        uint256 oracleRate = oracle.read();
        // convert amount to value in stablecoin
        uint256 stablecoinsValueToRedeem = (amount * oracleRate) / _assetBase;
        // Liquidity on Euler
        uint256 poolSize = stablecoin.balanceOf(address(euler));
        if (poolSize < stablecoinsValueToRedeem) stablecoinsValueToRedeem = poolSize;
        maxAmount = (stablecoinsValueToRedeem * _assetBase) / oracleRate;
    }

    /// @notice Virtual function to invest stablecoins
    /// @param amount Amount of new stablecoins managed
    /// @return amountInvested Amount invested in the strategy
    /// @dev Calling this function should eventually trigger something regarding strategies depending
    /// on a threshold
    /// @dev Amount should not be above maxExternalAmount defined in Euler otherwise it will revert
    function _push(uint256 amount) internal virtual override returns (uint256 amountInvested) {
        (uint256 lentAssets, uint256 looseAssets) = _report();

        if (looseAssets > minInvest) euler.deposit(0, looseAssets);
        // TODO should be equal to lentAssets + looseAssets  or  lentAssets in the else
        lastBalance = euler.balanceOfUnderlying(address(this)) + looseAssets;
        return amount;
    }

    /// @notice Virtual function to withdraw stablecoins
    /// @param amount Amount needed at the end of the call
    /// @return amountAvailable Amount available in the contracts, it's like a new `looseAssets` value
    /// @dev The call will revert if `stablecoin.balanceOf(address(euler))<amount`
    function _pull(uint256 amount) internal virtual override returns (uint256 amountAvailable) {
        (uint256 lentAssets, uint256 looseAssets) = _report();

        euler.withdraw(0, amount);
        // TODO should be equal to lentAssets + looseAssets - amount
        lastBalance = euler.balanceOfUnderlying(address(this)) + looseAssets - amount;

        return amount;
    }

    function _report() internal returns (uint256 lentAssets, uint256 looseAssets) {
        lentAssets = euler.balanceOfUnderlying(address(this));
        looseAssets = stablecoin.balanceOf(address(this));
        uint256 total = looseAssets + lentAssets;

        if (total > lastBalance) _handleGain(total - lastBalance);
        else _handleLoss(lastBalance - total);
    }
}
