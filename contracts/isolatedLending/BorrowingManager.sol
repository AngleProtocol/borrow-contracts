// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

import "./BorrowingManagerPermit.sol";

/// @title VaultManager
/// @author Angle Labs, Inc.
/// @notice This contract allows people to deposit collateral and open up loans of a given asset. It handles all the loan
/// logic (fees and interest rate) as well as the liquidation logic
/// @dev This implementation only supports non-rebasing ERC20 tokens as collateral
/// @dev This contract is encoded as a NFT contract
/* TODO
- decimals
- bad debt handling
- swapper calls
- simulations totalDebt
- setters
*/
contract BorrowingManager is BorrowingManagerPermit {
    using SafeERC20 for IERC20;
    using Address for address;

    uint256[48] private __gapVaultManager;

    /// @inheritdoc IVaultManagerFunctions
    function initialize(
        IERC20 _asset,
        IERC20 _collateral,
        ICoreBorrow _coreBorrow,
        IInterestRateModel _interestRateModel,
        ILender _lender,
        IOracle _oracle,
        VaultParameters calldata params,
        string memory _symbol
    ) external initializer {
        coreBorrow = _coreBorrow;
        interestRateModel = _interestRateModel;
        lender = _lender;
        collateral = _collateral;
        _collatBase = 10**(IERC20Metadata(address(_collateral)).decimals());
        _assetBase = 10**(IERC20Metadata(address(_asset)).decimals());
        asset = _asset;
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
        liquidationSurcharge = params.liquidationSurcharge;
        maxLiquidationDiscount = params.maxLiquidationDiscount;
        liquidationBoost = params.baseBoost;
        paused = true;
    }

    // ================================= MODIFIERS =================================

    /// @notice Checks whether the `msg.sender` has the governor role or not
    modifier onlyGovernor() {
        if (!coreBorrow.isGovernor(msg.sender)) revert NotGovernor();
        _;
    }

    /// @notice Checks whether the `msg.sender` has the governor role or the guardian role
    modifier onlyGovernorOrGuardian() {
        if (!coreBorrow.isGovernorOrGuardian(msg.sender)) revert NotGovernorOrGuardian();
        _;
    }

    /// @notice Checks whether the contract is paused
    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    // ============================== VAULT FUNCTIONS ==============================

    /// @inheritdoc IVaultManagerFunctions
    function createVault(address toVault) external whenNotPaused returns (uint256) {
        return _mint(toVault);
    }

    /// @inheritdoc IVaultManagerFunctions
    function angle(
        ActionType[] memory actions,
        bytes[] memory datas,
        address from,
        address to
    ) external returns (PaymentData memory) {
        return angle(actions, datas, from, to, address(0), new bytes(0));
    }

    /// @inheritdoc IVaultManagerFunctions
    function angle(
        ActionType[] memory actions,
        bytes[] memory datas,
        address from,
        address to,
        address who,
        bytes memory repayData
    ) public whenNotPaused nonReentrant returns (PaymentData memory paymentData) {
        if (actions.length != datas.length || actions.length == 0) revert IncompatibleLengths();
        // `newInterestAccumulator` and `oracleValue` are expensive to compute. Therefore, they are computed
        // only once inside the first action where they are necessary, then they are passed forward to further actions
        uint256 newInterestAccumulator;
        uint256 oracleValue;
        uint256 collateralAmount;
        uint256 assetAmount;
        uint256 vaultID;
        for (uint256 i = 0; i < actions.length; i++) {
            ActionType action = actions[i];
            // Processing actions which do not need the value of the oracle or of the `interestAccumulator`
            if (action == ActionType.createVault) {
                _mint(abi.decode(datas[i], (address)));
            } else if (action == ActionType.addCollateral) {
                (vaultID, collateralAmount) = abi.decode(datas[i], (uint256, uint256));
                if (vaultID == 0) vaultID = vaultIDCount;
                _addCollateral(vaultID, collateralAmount);
                paymentData.collateralAmountToReceive += collateralAmount;
            } else if (action == ActionType.permit) {
                address owner;
                bytes32 r;
                bytes32 s;
                // Watch out naming conventions for permit are not respected to save some space and reduce the stack size
                // `vaultID` is used in place of the `deadline` parameter
                // Same for `collateralAmount` used in place of `value`
                // `assetAmount` is used in place of the `v`
                (owner, collateralAmount, vaultID, assetAmount, r, s) = abi.decode(
                    datas[i],
                    (address, uint256, uint256, uint256, bytes32, bytes32)
                );
                IERC20PermitUpgradeable(address(collateral)).permit(
                    owner,
                    address(this),
                    collateralAmount,
                    vaultID,
                    uint8(assetAmount),
                    r,
                    s
                );
            } else {
                // Processing actions which rely on the `interestAccumulator`: first accruing it to make
                // sure surplus is correctly taken into account between debt changes
                if (newInterestAccumulator == 0) newInterestAccumulator = _accrue();
                if (action == ActionType.repayDebt) {
                    (vaultID, assetAmount) = abi.decode(datas[i], (uint256, uint256));
                    if (vaultID == 0) vaultID = vaultIDCount;
                    assetAmount = _repayDebt(vaultID, assetAmount, newInterestAccumulator);
                    paymentData.assetAmountToReceive += assetAmount;
                } else {
                    // Processing actions which need the oracle value
                    if (oracleValue == 0) oracleValue = oracle.read();
                    if (action == ActionType.closeVault) {
                        vaultID = abi.decode(datas[i], (uint256));
                        if (vaultID == 0) vaultID = vaultIDCount;
                        (assetAmount, collateralAmount) = _closeVault(vaultID, oracleValue, newInterestAccumulator);
                        paymentData.collateralAmountToGive += collateralAmount;
                        paymentData.assetAmountToReceive += assetAmount;
                    } else if (action == ActionType.removeCollateral) {
                        (vaultID, collateralAmount) = abi.decode(datas[i], (uint256, uint256));
                        if (vaultID == 0) vaultID = vaultIDCount;
                        _removeCollateral(vaultID, collateralAmount, oracleValue, newInterestAccumulator);
                        paymentData.collateralAmountToGive += collateralAmount;
                    } else if (action == ActionType.borrow) {
                        (vaultID, assetAmount) = abi.decode(datas[i], (uint256, uint256));
                        if (vaultID == 0) vaultID = vaultIDCount;
                        assetAmount = _borrow(vaultID, assetAmount, oracleValue, newInterestAccumulator);
                        paymentData.assetAmountToGive += assetAmount;
                    }
                }
            }
        }

        // Processing the different cases for the repayment, there are 4 of them:
        // - (1) Stablecoins to receive + collateral to send
        // - (2) Stablecoins to receive + collateral to receive
        // - (3) Stablecoins to send + collateral to send
        // - (4) Stablecoins to send + collateral to receive
        if (paymentData.assetAmountToReceive >= paymentData.assetAmountToGive) {
            uint256 assetPayment = paymentData.assetAmountToReceive - paymentData.assetAmountToGive;
            if (paymentData.collateralAmountToGive >= paymentData.collateralAmountToReceive) {
                // In the case where all amounts are null, the function will enter here and nothing will be done
                // for the repayment
                _handleRepay(
                    // Collateral payment is the difference between what to give and what to receive
                    paymentData.collateralAmountToGive - paymentData.collateralAmountToReceive,
                    assetPayment,
                    from,
                    to,
                    who,
                    repayData
                );
            } else {
                if (assetPayment > 0) {
                    _burnFrom(assetPayment, from);
                }
                // In this case the collateral amount is necessarily non null
                collateral.safeTransferFrom(
                    msg.sender,
                    address(this),
                    paymentData.collateralAmountToReceive - paymentData.collateralAmountToGive
                );
            }
        } else {
            uint256 assetPayment = paymentData.assetAmountToGive - paymentData.assetAmountToReceive;
            // `assetPayment` is strictly positive in this case
            lender.pull(assetPayment, to);
            if (paymentData.collateralAmountToGive > paymentData.collateralAmountToReceive) {
                collateral.safeTransfer(to, paymentData.collateralAmountToGive - paymentData.collateralAmountToReceive);
            } else {
                uint256 collateralPayment = paymentData.collateralAmountToReceive - paymentData.collateralAmountToGive;
                if (collateralPayment > 0) {
                    if (repayData.length > 0) {
                        ISwapper(who).swap(
                            asset,
                            collateral,
                            msg.sender,
                            // As per the `ISwapper` interface, we must first give the amount of token owed by the address before
                            // the amount of token it (or another related address) obtained
                            collateralPayment,
                            assetPayment,
                            repayData
                        );
                    }
                    collateral.safeTransferFrom(msg.sender, address(this), collateralPayment);
                }
            }
        }
    }

    // =============================== VIEW FUNCTIONS ==============================

    /// @inheritdoc IVaultManagerFunctions
    function getVaultDebt(uint256 vaultID) external view returns (uint256) {
        return (vaultData[vaultID].normalizedDebt * _calculateCurrentInterestAccumulator()) / BASE_INTEREST;
    }

    /// @inheritdoc IVaultManagerFunctions
    function getTotalDebt() external view returns (uint256) {
        return (totalNormalizedDebt * _calculateCurrentInterestAccumulator()) / BASE_INTEREST;
    }

    /// @notice Checks whether a given vault is liquidable and if yes gives information regarding its liquidation
    /// @param vaultID ID of the vault to check
    /// @return liqOpp Description of the opportunity of liquidation
    /// @dev This function will revert if it's called on a vault that does not exist
    function checkLiquidation(uint256 vaultID) external view returns (LiquidationOpportunity memory liqOpp) {
        liqOpp = _checkLiquidation(vaultData[vaultID], oracle.read(), _calculateCurrentInterestAccumulator());
    }

    // ====================== INTERNAL UTILITY VIEW FUNCTIONS ======================

    /// @notice Computes the health factor of a given vault. This can later be used to check whether a given vault is solvent
    /// (i.e. should be liquidated or not)
    /// @param vault Data of the vault to check
    /// @param oracleValue Oracle value at the time of the call (it is in the base of the asset, that is for agTokens 10**18)
    /// @param newInterestAccumulator Value of the `interestAccumulator` at the time of the call
    /// @return healthFactor Health factor of the vault: if it's inferior to 1 (`BASE_PARAMS` in fact) this means that the vault can be liquidated
    /// @return currentDebt Current value of the debt of the vault (taking into account interest)
    /// @return collateralAmountInStable Collateral in the vault expressed in asset value
    function _isSolvent(
        Vault memory vault,
        uint256 oracleValue,
        uint256 newInterestAccumulator
    )
        internal
        view
        returns (
            uint256 healthFactor,
            uint256 currentDebt,
            uint256 collateralAmountInStable
        )
    {
        currentDebt = (vault.normalizedDebt * newInterestAccumulator) / BASE_INTEREST;
        collateralAmountInStable = (vault.collateralAmount * oracleValue) / _collatBase;
        if (currentDebt == 0) healthFactor = type(uint256).max;
        else healthFactor = (collateralAmountInStable * collateralFactor) / currentDebt;
    }

    /// @notice Calculates the current value of the `interestAccumulator` without updating the value
    /// in storage
    /// @dev This function avoids expensive exponentiation and the calculation is performed using a binomial approximation
    /// (1+x)^n = 1+n*x+[n/2*(n-1)]*x^2+[n/6*(n-1)*(n-2)*x^3...
    /// @dev The approximation slightly undercharges borrowers with the advantage of a great gas cost reduction
    /// @dev This function was mostly inspired from Aave implementation
    function _calculateCurrentInterestAccumulator() internal view returns (uint256) {
        uint256 exp = block.timestamp - lastInterestAccumulatorUpdated;
        uint256 totalDebt = (totalNormalizedDebt * interestAccumulator) / BASE_INTEREST;
        uint256 ratePerSecond = interestRateModel.computeInterestRate(
            (totalDebt * BASE_PARAMS) / (totalDebt + asset.balanceOf(address(this)))
        );
        if (exp == 0 || ratePerSecond == 0) return interestAccumulator;
        uint256 expMinusOne = exp - 1;
        uint256 expMinusTwo = exp > 2 ? exp - 2 : 0;
        uint256 basePowerTwo = (ratePerSecond * ratePerSecond + HALF_BASE_INTEREST) / BASE_INTEREST;
        uint256 basePowerThree = (basePowerTwo * ratePerSecond + HALF_BASE_INTEREST) / BASE_INTEREST;
        uint256 secondTerm = (exp * expMinusOne * basePowerTwo) / 2;
        uint256 thirdTerm = (exp * expMinusOne * expMinusTwo * basePowerThree) / 6;
        return (interestAccumulator * (BASE_INTEREST + ratePerSecond * exp + secondTerm + thirdTerm)) / BASE_INTEREST;
    }

    // ================= INTERNAL UTILITY STATE-MODIFYING FUNCTIONS ================

    /// @notice Closes a vault without handling the repayment of the concerned address
    /// @param vaultID ID of the vault to close
    /// @param oracleValue Oracle value at the start of the call
    /// @param newInterestAccumulator Interest rate accumulator value at the start of the call
    /// @return Current debt of the vault to be repaid
    /// @return Value of the collateral in the vault to reimburse
    /// @dev The returned values are here to facilitate composability between calls
    function _closeVault(
        uint256 vaultID,
        uint256 oracleValue,
        uint256 newInterestAccumulator
    ) internal onlyApprovedOrOwner(msg.sender, vaultID) returns (uint256, uint256) {
        Vault memory vault = vaultData[vaultID];
        (uint256 healthFactor, uint256 currentDebt, ) = _isSolvent(vault, oracleValue, newInterestAccumulator);
        if (healthFactor <= BASE_PARAMS) revert InsolventVault();
        totalNormalizedDebt -= vault.normalizedDebt;
        _burn(vaultID);
        return (currentDebt, vault.collateralAmount);
    }

    /// @notice Increases the collateral balance of a vault
    /// @param vaultID ID of the vault to increase the collateral balance of
    /// @param collateralAmount Amount by which increasing the collateral balance of
    function _addCollateral(uint256 vaultID, uint256 collateralAmount) internal {
        if (!_exists(vaultID)) revert NonexistentVault();
        _checkpointCollateral(vaultID, false);
        vaultData[vaultID].collateralAmount += collateralAmount;
        emit CollateralAmountUpdated(vaultID, collateralAmount, 1);
    }

    /// @notice Decreases the collateral balance from a vault (without proceeding to collateral transfers)
    /// @param vaultID ID of the vault to decrease the collateral balance of
    /// @param collateralAmount Amount of collateral to reduce the balance of
    /// @param oracleValue Oracle value at the start of the call (given here to avoid double computations)
    /// @param interestAccumulator_ Value of the interest rate accumulator (potentially zero if it has not been
    /// computed yet)
    function _removeCollateral(
        uint256 vaultID,
        uint256 collateralAmount,
        uint256 oracleValue,
        uint256 interestAccumulator_
    ) internal onlyApprovedOrOwner(msg.sender, vaultID) {
        _checkpointCollateral(vaultID, false);
        vaultData[vaultID].collateralAmount -= collateralAmount;
        (uint256 healthFactor, , ) = _isSolvent(vaultData[vaultID], oracleValue, interestAccumulator_);
        if (healthFactor <= BASE_PARAMS) revert InsolventVault();
        emit CollateralAmountUpdated(vaultID, collateralAmount, 0);
    }

    /// @notice Increases the debt balance of a vault and takes into account borrowing fees
    /// @param vaultID ID of the vault to increase borrow balance of
    /// @param assetAmount Amount of assets to borrow
    /// @param oracleValue Oracle value at the start of the call
    /// @param newInterestAccumulator Value of the interest rate accumulator
    /// @return toMint Amount of assets to mint
    function _borrow(
        uint256 vaultID,
        uint256 assetAmount,
        uint256 oracleValue,
        uint256 newInterestAccumulator
    ) internal onlyApprovedOrOwner(msg.sender, vaultID) returns (uint256 toMint) {
        // We normalize the amount by dividing it by `newInterestAccumulator`. This makes accounting easier, since
        // it allows us to process all (past and future) debts like debts created at the inception of the contract.
        uint256 changeAmount = (assetAmount * BASE_INTEREST) / newInterestAccumulator;
        // if there was no previous debt, we have to check that the debt creation will be higher than `dust`
        if (vaultData[vaultID].normalizedDebt == 0)
            if (assetAmount <= dust) revert DustyLeftoverAmount();
        vaultData[vaultID].normalizedDebt += changeAmount;
        totalNormalizedDebt += changeAmount;
        if (totalNormalizedDebt * newInterestAccumulator > debtCeiling * BASE_INTEREST) revert DebtCeilingExceeded();
        (uint256 healthFactor, , ) = _isSolvent(vaultData[vaultID], oracleValue, newInterestAccumulator);
        if (healthFactor <= BASE_PARAMS) revert InsolventVault();
        emit InternalDebtUpdated(vaultID, changeAmount, 1);
        return (changeAmount * newInterestAccumulator) / BASE_INTEREST;
    }

    /// @notice Decreases the debt of a given vault and verifies that this vault still has an amount of debt superior
    /// to a dusty amount or no debt at all
    /// @param vaultID ID of the vault to decrease the debt of
    /// @param assetAmount Amount of asset to decrease the debt of: this amount is converted in
    /// normalized debt using the pre-computed (or not) `newInterestAccumulator` value
    /// To repay the whole debt, one can pass `type(uint256).max`
    /// @param newInterestAccumulator Value of the interest rate accumulator
    /// @return Amount of assets to be burnt to correctly repay the debt
    /// @dev If `assetAmount` is `type(uint256).max`, this function will repay all the debt of the vault
    function _repayDebt(
        uint256 vaultID,
        uint256 assetAmount,
        uint256 newInterestAccumulator
    ) internal returns (uint256) {
        uint256 newVaultNormalizedDebt = vaultData[vaultID].normalizedDebt;
        // To save one variable declaration, `changeAmount` is first expressed in asset amount before being converted
        // to a normalized amount. Here we first store the maximum amount that can be repaid given the current debt
        uint256 changeAmount = (newVaultNormalizedDebt * newInterestAccumulator) / BASE_INTEREST;
        // In some situations (e.g. liquidations), the `assetAmount` is rounded above and we want to make
        // sure to avoid underflows in all situations
        if (assetAmount >= changeAmount) {
            assetAmount = changeAmount;
            changeAmount = newVaultNormalizedDebt;
        } else {
            changeAmount = (assetAmount * BASE_INTEREST) / newInterestAccumulator;
        }
        newVaultNormalizedDebt -= changeAmount;
        totalNormalizedDebt -= changeAmount;
        if (newVaultNormalizedDebt != 0 && newVaultNormalizedDebt * newInterestAccumulator <= dust * BASE_INTEREST)
            revert DustyLeftoverAmount();
        vaultData[vaultID].normalizedDebt = newVaultNormalizedDebt;
        emit InternalDebtUpdated(vaultID, changeAmount, 0);
        return assetAmount;
    }

    /// @notice Handles the simultaneous repayment of assets with a transfer of collateral
    /// @param collateralAmountToGive Amount of collateral the contract should give
    /// @param stableAmountToRepay Amount of assets the contract should burn from the call
    /// @param from Address from which assets should be burnt: it should be the `msg.sender` or at least
    /// approved by it
    /// @param to Address to which collateral should be sent
    /// @param who Address which should be notified if needed of the transfer
    /// @param data Data to pass to the `who` contract for it to successfully give the correct amount of assets
    /// to the `from` address
    /// @dev This function allows for capital-efficient liquidations and repayments of loans
    function _handleRepay(
        uint256 collateralAmountToGive,
        uint256 stableAmountToRepay,
        address from,
        address to,
        address who,
        bytes memory data
    ) internal {
        if (collateralAmountToGive > 0) collateral.safeTransfer(to, collateralAmountToGive);
        if (stableAmountToRepay > 0) {
            if (data.length > 0) {
                ISwapper(who).swap(collateral, asset, from, stableAmountToRepay, collateralAmountToGive, data);
            }
            _burnFrom(stableAmountToRepay, from);
        }
    }

    function _burnFrom(uint256 assetToRepay, address from) internal {
        if (from != msg.sender && asset.allowance(from, msg.sender) < assetToRepay) revert ZeroAddress();
        asset.safeTransferFrom(from, lender, assetToRepay);
        lender.push(assetToRepay);
    }

    // ====================== TREASURY RELATIONSHIP FUNCTIONS ======================

    function accrue() external returns (uint256) {
        return _accrue();
    }

    /// @notice Accrues interest accumulated across all vaults to the surplus and updates the `interestAccumulator`
    /// @return newInterestAccumulator Computed value of the interest accumulator
    /// @dev It should also be called when updating the value of the per second interest rate or when the `totalNormalizedDebt`
    /// value is about to change
    function _accrue() internal returns (uint256 newInterestAccumulator) {
        newInterestAccumulator = _calculateCurrentInterestAccumulator();
        uint256 interestAccrued = (totalNormalizedDebt * (newInterestAccumulator - interestAccumulator)) /
            BASE_INTEREST;
        uint256 accruedForGovernance = (interestAccrued * reserveFactor) / BASE_PARAMS;
        lender.distribute(accruedForGovernance, interestAccrued);
        interestAccumulator = newInterestAccumulator;
        lastInterestAccumulatorUpdated = block.timestamp;
        emit InterestAccumulatorUpdated(newInterestAccumulator, block.timestamp);
        return newInterestAccumulator;
    }

    // ================================ LIQUIDATIONS ===============================

    /// @notice Liquidates an ensemble of vaults specified by their IDs
    /// @dev This function is a simplified wrapper of the function below. It is built to remove for liquidators the need to specify
    /// a `who` and a `data` parameter
    function liquidate(
        uint256[] memory vaultIDs,
        uint256[] memory amounts,
        address from,
        address to
    ) external returns (LiquidatorData memory) {
        return liquidate(vaultIDs, amounts, from, to, address(0), new bytes(0));
    }

    /// @notice Liquidates an ensemble of vaults specified by their IDs
    /// @param vaultIDs List of the vaults to liquidate
    /// @param amounts Amount of asset to bring for the liquidation of each vault
    /// @param from Address from which the assets for the liquidation should be taken: this address should be the `msg.sender`
    /// or have received an approval
    /// @param to Address to which discounted collateral should be sent
    /// @param who Address of the contract to handle repayment of assets from received collateral
    /// @param data Data to pass to the repayment contract in case of. If empty, liquidators simply have to bring the exact amount of
    /// assets to get the discounted collateral. If not, it is used by the repayment contract to swap a portion or all
    /// of the collateral received to assets to be sent to the `from` address. More details in the `_handleRepay` function
    /// @return liqData Data about the liquidation process for the liquidator to track everything that has been going on (like how much
    /// assets have been repaid, how much collateral has been received)
    /// @dev This function will revert if it's called on a vault that cannot be liquidated or that does not exist
    function liquidate(
        uint256[] memory vaultIDs,
        uint256[] memory amounts,
        address from,
        address to,
        address who,
        bytes memory data
    ) public whenNotPaused nonReentrant returns (LiquidatorData memory liqData) {
        if (vaultIDs.length != amounts.length || amounts.length == 0) revert IncompatibleLengths();
        // Stores all the data about an ongoing liquidation of multiple vaults
        liqData.oracleValue = oracle.read();
        liqData.newInterestAccumulator = _accrue();
        emit LiquidatedVaults(vaultIDs);
        for (uint256 i = 0; i < vaultIDs.length; i++) {
            Vault memory vault = vaultData[vaultIDs[i]];
            // Computing if liquidation can take place for a vault
            LiquidationOpportunity memory liqOpp = _checkLiquidation(
                vault,
                liqData.oracleValue,
                liqData.newInterestAccumulator
            );

            // Makes sure not to leave a dusty amount in the vault by either not liquidating too much
            // or everything
            if (
                (liqOpp.thresholdRepayAmount > 0 && amounts[i] > liqOpp.thresholdRepayAmount) ||
                amounts[i] > liqOpp.maxAssetAmountToRepay
            ) amounts[i] = liqOpp.maxAssetAmountToRepay;

            // liqOpp.discount stores in fact `1-discount`
            uint256 collateralReleased = (amounts[i] * BASE_PARAMS * _collatBase) /
                (liqOpp.discount * liqData.oracleValue);

            _checkpointCollateral(vaultIDs[i], vault.collateralAmount <= collateralReleased);
            // Because we're rounding up in some divisions, `collateralReleased` can be greater than the `collateralAmount` of the vault
            // In this case, `assetAmountToReceive` is still rounded up
            if (vault.collateralAmount <= collateralReleased) {
                collateralReleased = vault.collateralAmount;
                // Remove all the vault's debt (debt repayed + bad debt) from VaultManager totalDebt
                totalNormalizedDebt -= vault.normalizedDebt;
                // Reinitializing the `vaultID`: we're not burning the vault in this case for integration purposes
                // TODO badDebt in this case -> affect lenders
                delete vaultData[vaultIDs[i]];
                emit InternalDebtUpdated(vaultIDs[i], vault.normalizedDebt, 0);
            } else {
                vaultData[vaultIDs[i]].collateralAmount -= collateralReleased;
                _repayDebt(
                    vaultIDs[i],
                    (amounts[i] * liquidationSurcharge) / BASE_PARAMS,
                    liqData.newInterestAccumulator
                );
            }
            liqData.collateralAmountToGive += collateralReleased;
            liqData.assetAmountToReceive += amounts[i];
        }
        _handleRepay(liqData.collateralAmountToGive, liqData.assetAmountToReceive, from, to, who, data);
    }

    /// @notice Internal version of the `checkLiquidation` function
    /// @dev This function takes two additional parameters as when entering this function `oracleValue`
    /// and `newInterestAccumulator` should have always been computed
    function _checkLiquidation(
        Vault memory vault,
        uint256 oracleValue,
        uint256 newInterestAccumulator
    ) internal view returns (LiquidationOpportunity memory liqOpp) {
        // Checking if the vault can be liquidated
        (uint256 healthFactor, uint256 currentDebt, uint256 collateralAmountInStable) = _isSolvent(
            vault,
            oracleValue,
            newInterestAccumulator
        );
        // Health factor of a vault that does not exist is `type(uint256).max`
        if (healthFactor >= BASE_PARAMS) revert HealthyVault();

        uint256 liquidationDiscount = (liquidationBoost * (BASE_PARAMS - healthFactor)) / BASE_PARAMS;
        // In fact `liquidationDiscount` is stored here as 1 minus discount to save some computation costs
        // This value is necessarily > 0 as `maxLiquidationDiscount < BASE_PARAMS`
        liquidationDiscount = liquidationDiscount >= maxLiquidationDiscount
            ? BASE_PARAMS - maxLiquidationDiscount
            : BASE_PARAMS - liquidationDiscount;
        // Same for the surcharge here: it's in fact 1 - the fee taken by the protocol
        uint256 surcharge = liquidationSurcharge;
        // Checking if we're in a situation where the health factor is an increasing or a decreasing function of the
        // amount repaid
        uint256 maxAmountToRepay;
        uint256 thresholdRepayAmount;
        // In the first case, the health factor is an increasing function of the asset amount to repay,
        // this means that the liquidator can bring the vault to the target health ratio
        if (healthFactor * liquidationDiscount * surcharge >= collateralFactor * BASE_PARAMS**2) {
            // This is the max amount to repay that will bring the person to the target health factor
            // Denom is always positive when a vault gets liquidated in this case and when the health factor
            // is an increasing function of the amount of assets repaid
            // And given that most parameters are in base 9, the numerator can very hardly overflow here
            maxAmountToRepay =
                ((targetHealthFactor * currentDebt - collateralAmountInStable * collateralFactor) *
                    BASE_PARAMS *
                    liquidationDiscount) /
                (surcharge * targetHealthFactor * liquidationDiscount - (BASE_PARAMS**2) * collateralFactor);
            // The quantity below tends to be rounded in the above direction, which means that governance or guardians should
            // set the `targetHealthFactor` accordingly
            // Need to check for the dust: liquidating should not leave a dusty amount in the vault
            if (currentDebt * BASE_PARAMS <= maxAmountToRepay * surcharge + dust * BASE_PARAMS) {
                // If liquidating to the target threshold would leave a dusty amount: the liquidator can repay all
                // We're rounding up the max amount to repay to make sure all the debt ends up being paid
                // and we're computing again the real value of the debt to avoid propagation of rounding errors
                maxAmountToRepay =
                    (vault.normalizedDebt * newInterestAccumulator * BASE_PARAMS) /
                    (surcharge * BASE_INTEREST) +
                    1;
                // In this case the threshold amount is such that it leaves just enough dust: amount is rounded
                // down such that if a liquidator repays this amount then there would be more than `dust` left in
                // the liquidated vault
                if (currentDebt > dust)
                    thresholdRepayAmount = ((currentDebt - dust) * BASE_PARAMS) / surcharge;
                    // If there is from the beginning a dusty debt (because of an implementation upgrade), then
                    // liquidator should repay everything that's left
                else thresholdRepayAmount = 1;
            }
        } else {
            // In all cases the liquidator can repay assets such that they'll end up getting exactly the collateral
            // in the liquidated vault
            // Rounding up to make sure all gets liquidated in this case: the liquidator will never get more than the collateral
            // amount in the vault however: we're performing the computation of the `collateralAmountInStable` again to avoid
            // propagation of rounding errors
            maxAmountToRepay =
                (vault.collateralAmount * liquidationDiscount * oracleValue) /
                (BASE_PARAMS * _collatBase) +
                1;
            // It should however make sure not to leave a dusty amount of collateral (in asset value) in the vault
            if (collateralAmountInStable > _dustCollateral)
                // There's no issue with this amount being rounded down
                thresholdRepayAmount =
                    ((collateralAmountInStable - _dustCollateral) * liquidationDiscount) /
                    BASE_PARAMS;
                // If there is from the beginning a dusty amount of collateral, liquidator should repay everything that's left
            else thresholdRepayAmount = 1;
        }
        liqOpp.maxAssetAmountToRepay = maxAmountToRepay;
        liqOpp.maxCollateralAmountGiven =
            (maxAmountToRepay * BASE_PARAMS * _collatBase) /
            (oracleValue * liquidationDiscount);
        liqOpp.thresholdRepayAmount = thresholdRepayAmount;
        liqOpp.discount = liquidationDiscount;
        liqOpp.currentDebt = currentDebt;
    }

    // ================================== SETTERS ==================================

    /// @notice Sets parameters encoded as uint64
    /// @param param Value for the parameter
    /// @param what Parameter to change
    /// @dev This function performs the required checks when updating a parameter
    /// @dev When setting parameters governance or the guardian should make sure that when `HF < CF/((1-surcharge)(1-discount))`
    /// and hence when liquidating a vault is going to decrease its health factor, `discount = max discount`.
    /// Otherwise, it may be profitable for the liquidator to liquidate in multiple times: as it will decrease
    /// the HF and therefore increase the discount between each time
    function setUint64(uint64 param, bytes32 what) external onlyGovernorOrGuardian {
        if (what == "CF") {
            if (param > liquidationSurcharge) revert TooHighParameterValue();
            collateralFactor = param;
        } else if (what == "THF") {
            if (param < BASE_PARAMS) revert TooSmallParameterValue();
            targetHealthFactor = param;
        } else if (what == "LS") {
            if (collateralFactor > param) revert InvalidParameterValue();
            liquidationSurcharge = param;
        } else if (what == "MLD") {
            if (param > BASE_PARAMS) revert TooHighParameterValue();
            maxLiquidationDiscount = param;
        } else {
            revert InvalidParameterType();
        }
        emit FiledUint64(param, what);
    }

    /// @notice Sets `debtCeiling`
    /// @param _debtCeiling New value for `debtCeiling`
    /// @dev `debtCeiling` should not be bigger than `type(uint256).max / 10**27` otherwise there could be overflows
    function setDebtCeiling(uint256 _debtCeiling) external onlyGovernorOrGuardian {
        debtCeiling = _debtCeiling;
        emit DebtCeilingUpdated(_debtCeiling);
    }

    /// @notice Pauses external permissionless functions of the contract
    function togglePause() external onlyGovernorOrGuardian {
        paused = !paused;
    }

    /// @notice Changes the ERC721 metadata URI
    function setBaseURI(string memory baseURI_) external onlyGovernorOrGuardian {
        _baseURI = baseURI_;
    }

    /// @notice Changes the reference to the oracle contract used to get the price of the oracle
    /// @param _oracle Reference to the oracle contract
    function setOracle(address _oracle) external onlyGovernor {
        if (_oracle == address(0)) return ZeroAddress();
        oracle = IOracle(_oracle);
    }

    /// @notice Sets the dust variables
    /// @dev These variables are not taken into account in all circumstances as the actual dust variables
    function setDusts(uint256 newDust, uint256 newDustCollateral) external onlyGovernor {
        dust = newDust;
        _dustCollateral = newDustCollateral;
    }

    // ============================= VIRTUAL FUNCTIONS =============================

    /// @notice Hook called before any collateral internal changes
    /// @param vaultID Vault which sees its collateral amount changed
    /// @param burn Whether the vault was emptied from all its collateral
    function _checkpointCollateral(uint256 vaultID, bool burn) internal virtual {}
}
