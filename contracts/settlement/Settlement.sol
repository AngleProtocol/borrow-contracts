// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import "../interfaces/IAgToken.sol";
import "../interfaces/IVaultManager.sol";

/// @title Settlement
/// @author Angle Core Team
/// @notice Settlement Contract for a VaultManager
/// @dev This settlement contract should be activated by a careful governance which needs to have performed
/// some key operations before activating this contract
/// @dev In case of global settlement, there should be one settlement contract per `VaultManager`
contract Settlement {
    using SafeERC20 for IERC20;

    /// @notice Base used for parameter computation
    uint256 public constant BASE_PARAMS = 10**9;
    /// @notice Base used for interest computation
    uint256 public constant BASE_INTEREST = 10**27;
    /// @notice Base used for exchange rate computation. It is assumed
    /// that stablecoins have this base
    uint256 public constant BASE_STABLECOIN = 10**18;

    // =============== Immutable references set in the constructor =================

    /// @notice `VaultManager` of this settlement contract
    IVaultManager public immutable vaultManager;
    /// @notice Reference to the stablecoin supported by the `VaultManager` contract
    IAgToken public immutable stablecoin;
    /// @notice Reference to the collateral supported by the `VaultManager`
    IERC20 public immutable collateral;
    /// @notice Base of the collateral
    uint256 internal immutable _collatBase;

    // ================ Variables frozen at settlement activation ==================

    /// @notice Length of the claim period for owners of over-collateralized vaults
    uint256 public overCollateralizedClaimsDuration;
    /// @notice Value of the oracle for the collateral/stablecoin pair
    uint256 public oracleValue;
    /// @notice Value of the interest accumulator at settlement activation
    uint256 public interestAccumulator;
    /// @notice Timestamp at which settlement was activated
    uint256 public activationTimestamp;
    /// @notice Collateral factor of the `VaultManager`
    uint64 public collateralFactor;

    // =================== Variables updated during the process ====================

    /// @notice Stablecoin/Collateral exchange rate at the end of the period allowing over-collateralized vaults
    /// to recover their claims
    uint256 public stablecoinCollateralExchangeRate;
    /// @notice Amount of collateral that will be left over at the end of the process
    uint256 public leftOverCollateral;
    /// @notice Maps a vault to whether it was claimed or not by its owner
    mapping(uint256 => bool) public vaultCheck;

    // ================================ Events =====================================

    event GlobalClaimPeriodActivated(uint256 _stablecoinCollateralExchangeRate);
    event Recovered(address indexed tokenAddress, address indexed to, uint256 amount);
    event SettlementActivated(uint256 _overCollateralizedClaimsDuration, uint256 startTimestamp);
    event VaultClaimed(uint256 vaultID, uint256 stablecoinAmount, uint256 collateralAmount);

    /// @notice Constructor of the contract
    /// @param _vaultManager Address of the `VaultManager` associated to this `Settlement` contract
    /// @dev Out of safety, this constructor reads values from the `VaultManager` contract directly
    constructor(IVaultManager _vaultManager) {
        vaultManager = _vaultManager;
        stablecoin = _vaultManager.stablecoin();
        collateral = _vaultManager.collateral();
        _collatBase = 10**(IERC20Metadata(address(collateral)).decimals());
    }

    /// @notice Checks whether the `msg.sender` has the governor role or not
    modifier onlyGovernor() {
        require(vaultManager.treasury().isGovernor(msg.sender), "1");
        _;
    }

    /// @notice Activates the settlement contract
    /// @param _overCollateralizedClaimsDuration Duration of the period for owners of over-collateralized vaults
    /// to claim it
    /// @dev When calling this function governance should make sure to have:
    /// 1. Accrued the interest rate on the contract
    /// 2. Paused the contract
    /// 3. Recovered all the collateral available in the `VaultManager` contract either
    /// by doing a contract upgrade or by calling a `recoverERC20` method if supported
    function activateSettlement(uint256 _overCollateralizedClaimsDuration) external onlyGovernor {
        overCollateralizedClaimsDuration = _overCollateralizedClaimsDuration;
        oracleValue = (vaultManager.oracle()).read();
        interestAccumulator = vaultManager.interestAccumulator();
        activationTimestamp = block.timestamp;
        collateralFactor = vaultManager.collateralFactor();
        emit SettlementActivated(_overCollateralizedClaimsDuration, block.timestamp);
    }

    /// @notice Allows the owner of an over-collateralized vault to claim its collateral upon bringing back all owed stablecoins
    /// @param vaultID ID of the vault to claim
    /// @param to Address to which collateral should be sent
    /// @return Amount of stablecoins sent to the contract
    /// @return Amount of collateral sent to the `to` address
    /// @dev Claiming can only happen short after settlement activation
    /// @dev A vault cannot be claimed twice and only the owner of the vault can claim it (regardless of the approval logic)
    /// @dev Only over-collateralized vaults can be claimed from this medium
    function claimOverCollateralizedVault(uint256 vaultID, address to) external returns (uint256, uint256) {
        require(
            activationTimestamp != 0 && block.timestamp <= activationTimestamp + overCollateralizedClaimsDuration,
            "41"
        );
        require(!vaultCheck[vaultID], "43");
        require(vaultManager.ownerOf(vaultID) == msg.sender, "42");
        (uint256 collateralAmount, uint256 normalizedDebt) = vaultManager.vaultData(vaultID);
        uint256 vaultDebt = (normalizedDebt * interestAccumulator) / BASE_INTEREST;
        require(collateralAmount * oracleValue * collateralFactor >= vaultDebt * BASE_PARAMS * _collatBase, "21");
        vaultCheck[vaultID] = true;
        emit VaultClaimed(vaultID, vaultDebt, collateralAmount);
        return _handleTransfer(vaultDebt, collateralAmount, to);
    }

    /// @notice Activates the global claim period by setting the `stablecoinCollateralExchangeRate` which is going to
    /// dictate how much of collateral will be recoverable for each stablecoin
    /// @dev This function can only be called by the governor in order to allow it in case multiple settlements happen across
    /// different `VaultManager` to rebalance the amount of stablecoins on each to make sure that across all settlement contracts
    /// a similar value of collateral can be obtained against a similar value of stablecoins
    function activateGlobalClaimPeriod() external onlyGovernor {
        require(
            activationTimestamp != 0 && block.timestamp > activationTimestamp + overCollateralizedClaimsDuration,
            "44"
        );
        uint256 collateralBalance = collateral.balanceOf(address(this));
        uint256 leftOverDebt = (vaultManager.totalNormalizedDebt() * interestAccumulator) /
            BASE_INTEREST -
            stablecoin.balanceOf(address(this));
        // How much 1 of stablecoin will give in collateral (it's an opposite of oracle value)
        uint256 _stablecoinCollateralExchangeRate = (collateralBalance * BASE_STABLECOIN * BASE_STABLECOIN) /
            (leftOverDebt * _collatBase);
        // A too high value means that too much collateral could be obtained from stablecoins
        uint256 maxExchangeRate = BASE_STABLECOIN**2 / oracleValue;
        if (_stablecoinCollateralExchangeRate >= maxExchangeRate) {
            leftOverCollateral = collateralBalance - (leftOverDebt * _collatBase) / oracleValue;
            _stablecoinCollateralExchangeRate = maxExchangeRate;
        }
        stablecoinCollateralExchangeRate = _stablecoinCollateralExchangeRate;
        emit GlobalClaimPeriodActivated(_stablecoinCollateralExchangeRate);
    }

    /// @notice Allows to claim collateral from stablecoins
    /// @param to Address to which collateral should be sent
    /// @return Amount of stablecoins sent to the contract
    /// @return Amount of collateral sent to the `to` address
    /// @dev This function reverts if the `stablecoinCollateralExchangeRate` is null and hence if the global claim period has
    /// not been activated
    function claimCollateralFromStablecoins(uint256 stablecoinAmount, address to) external returns (uint256, uint256) {
        require(stablecoinCollateralExchangeRate != 0, "45");
        return
            _handleTransfer(stablecoinAmount, (stablecoinAmount * _collatBase) / stablecoinCollateralExchangeRate, to);
    }

    /// @notice Handles the transfer of stablecoins from the `msg.sender` to the protocol and of
    /// collateral from the protocol to the `msg.sender`
    /// @param stablecoinAmount Amount of stablecoins to transfer to the protocol
    /// @param collateralAmount Amount of collateral to transfer to the `to` address
    /// @param to Address to which collateral should be sent
    /// @return Amount of stablecoins sent to the contract
    /// @return Amount of collateral sent to the `to` address
    function _handleTransfer(
        uint256 stablecoinAmount,
        uint256 collateralAmount,
        address to
    ) internal returns (uint256, uint256) {
        stablecoin.transferFrom(msg.sender, address(this), stablecoinAmount);
        collateral.safeTransfer(to, collateralAmount);
        return (stablecoinAmount, collateralAmount);
    }

    /// @notice Recovers leftover tokens from the contract or tokens that were mistakenly sent to the contract
    /// @param tokenAddress Address of the token to recover
    /// @param to Address to send the remaining tokens to
    /// @param amountToRecover Amount to recover from the contract
    /// @dev Governors cannot recover more collateral than what would be leftover from the contract
    /// @dev This function can be used to rebalance stablecoin balances across different settlement contracts
    /// to make sure every stablecoin can be redeemed for the same value of collateral
    /// @dev It can also be used to recover tokens that are mistakenly sent to this contract
    function recoverERC20(
        address tokenAddress,
        address to,
        uint256 amountToRecover
    ) external onlyGovernor {
        if (tokenAddress == address(collateral)) {
            require(stablecoinCollateralExchangeRate != 0, "45");
            leftOverCollateral -= amountToRecover;
            collateral.safeTransfer(to, amountToRecover);
        } else {
            IERC20(tokenAddress).safeTransfer(to, amountToRecover);
        }
        emit Recovered(tokenAddress, to, amountToRecover);
    }
}
