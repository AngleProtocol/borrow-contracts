// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

import "./VaultManagerERC721.sol";

/// @title VaultManager
/// @author Angle Core Team
/// @notice This contract allows people to deposit collateral and open up loans of a given AgToken. It handles all the loan
/// logic (fees and interest rate) as well as the liquidation logic
/// @dev This implementation only supports non-rebasing ERC20 tokens as collateral
/// @dev This contract is encoded as a NFT contract
contract VaultManager is VaultManagerERC721, IVaultManagerFunctions {
    using SafeERC20 for IERC20;
    using Address for address;

    /// @inheritdoc IVaultManagerFunctions
    function initialize(
        ITreasury _treasury,
        IERC20 _collateral,
        IOracle _oracle,
        VaultParameters calldata params,
        string memory _symbol
    ) external initializer {
        require(_oracle.treasury() == _treasury, "33");
        treasury = _treasury;
        collateral = _collateral;
        _collatBase = 10**(IERC20Metadata(address(collateral)).decimals());
        stablecoin = IAgToken(_treasury.stablecoin());
        oracle = _oracle;

        name = string.concat("Angle Protocol ", _symbol, " Vault");
        symbol = string.concat(_symbol, "-vault");

        interestAccumulator = BASE_INTEREST;
        lastInterestAccumulatorUpdated = block.timestamp;

        // Checking if the parameters have been correctly initialized
        require(
            params.collateralFactor <= params.liquidationSurcharge &&
                BASE_PARAMS <= params.targetHealthFactor &&
                params.liquidationSurcharge <= BASE_PARAMS &&
                params.borrowFee <= BASE_PARAMS &&
                params.maxLiquidationDiscount < BASE_PARAMS &&
                0 < params.baseBoost,
            "15"
        );
        debtCeiling = params.debtCeiling;
        collateralFactor = params.collateralFactor;
        targetHealthFactor = params.targetHealthFactor;
        borrowFee = params.borrowFee;
        interestRate = params.interestRate;
        liquidationSurcharge = params.liquidationSurcharge;
        maxLiquidationDiscount = params.maxLiquidationDiscount;
        whitelistingActivated = params.whitelistingActivated;
        yLiquidationBoost = [params.baseBoost];
        paused = true;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(uint256 dust_, uint256 dustCollateral_) VaultManagerStorage(dust_, dustCollateral_) {}

    // ============================== Modifiers ====================================

    /// @notice Checks whether the `msg.sender` has the governor role or not
    modifier onlyGovernor() {
        require(treasury.isGovernor(msg.sender), "1");
        _;
    }

    /// @notice Checks whether the `msg.sender` has the governor role or the guardian role
    modifier onlyGovernorOrGuardian() {
        require(treasury.isGovernorOrGuardian(msg.sender), "2");
        _;
    }

    /// @notice Checks whether the `msg.sender` is the treasury contract
    modifier onlyTreasury() {
        require(msg.sender == address(treasury), "14");
        _;
    }

    /// @notice Checks whether the contract is paused
    modifier whenNotPaused() {
        require(!paused, "42");
        _;
    }

    // =========================== Vault Functions =================================

    // ========================= External Access Functions =========================

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
    ) external payable returns (PaymentData memory) {
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
    ) public payable whenNotPaused nonReentrant returns (PaymentData memory paymentData) {
        uint256 newInterestRateAccumulator;
        uint256 oracleValue;
        uint256 collateralAmount;
        uint256 stablecoinAmount;
        uint256 vaultID;
        for (uint256 i = 0; i < actions.length; i++) {
            ActionType action = actions[i];
            if (action == ActionType.createVault) {
                _mint(abi.decode(datas[i], (address)));
            } else if (action == ActionType.closeVault) {
                (stablecoinAmount, collateralAmount, oracleValue, newInterestRateAccumulator) = _closeVault(
                    abi.decode(datas[i], (uint256)),
                    oracleValue,
                    newInterestRateAccumulator
                );
                paymentData.collateralAmountToGive += collateralAmount;
                paymentData.stablecoinAmountToReceive += stablecoinAmount;
            } else if (action == ActionType.addCollateral) {
                (vaultID, collateralAmount) = abi.decode(datas[i], (uint256, uint256));
                _addCollateral(vaultID, collateralAmount);
                paymentData.collateralAmountToReceive += collateralAmount;
            } else if (action == ActionType.removeCollateral) {
                (vaultID, collateralAmount) = abi.decode(datas[i], (uint256, uint256));
                (oracleValue, newInterestRateAccumulator) = _removeCollateral(
                    vaultID,
                    collateralAmount,
                    oracleValue,
                    newInterestRateAccumulator
                );
                paymentData.collateralAmountToGive += collateralAmount;
            } else if (action == ActionType.repayDebt) {
                (vaultID, stablecoinAmount) = abi.decode(datas[i], (uint256, uint256));
                (stablecoinAmount, newInterestRateAccumulator) = _repayDebt(
                    vaultID,
                    stablecoinAmount,
                    newInterestRateAccumulator
                );
                paymentData.stablecoinAmountToReceive += stablecoinAmount;
            } else if (action == ActionType.borrow) {
                (vaultID, stablecoinAmount) = abi.decode(datas[i], (uint256, uint256));
                (stablecoinAmount, oracleValue, newInterestRateAccumulator) = _borrow(
                    vaultID,
                    stablecoinAmount,
                    oracleValue,
                    newInterestRateAccumulator
                );
                paymentData.stablecoinAmountToGive += stablecoinAmount;
            } else if (action == ActionType.getDebtIn) {
                address vaultManager;
                uint256 dstVaultID;
                (vaultID, vaultManager, dstVaultID, stablecoinAmount) = abi.decode(
                    datas[i],
                    (uint256, address, uint256, uint256)
                );
                (oracleValue, newInterestRateAccumulator) = _getDebtIn(
                    vaultID,
                    IVaultManager(vaultManager),
                    dstVaultID,
                    stablecoinAmount,
                    oracleValue,
                    newInterestRateAccumulator
                );
            } else if (action == ActionType.permit) {
                address owner;
                bytes32 r;
                bytes32 s;
                // Watch out naming conventions for permit are not respected to save some space and reduce the stack size
                // `vaultID` is used in place of the `deadline` parameter
                // Same for `collateralAmount` used in place of `value`
                // `stablecoinAmount` is used in place of the `v`
                (owner, collateralAmount, vaultID, stablecoinAmount, r, s) = abi.decode(
                    datas[i],
                    (address, uint256, uint256, uint256, bytes32, bytes32)
                );
                IERC20PermitUpgradeable(address(collateral)).permit(
                    owner,
                    address(this),
                    collateralAmount,
                    vaultID,
                    uint8(stablecoinAmount),
                    r,
                    s
                );
            }
        }

        // Processing the different cases for the repayment, there are 4 of them:
        // - (1) Stablecoins to receive + collateral to send
        // - (2) Stablecoins to receive + collateral to receive
        // - (3) Stablecoins to send + collateral to send
        // - (4) Stablecoins to send + collateral to receive
        if (paymentData.stablecoinAmountToReceive >= paymentData.stablecoinAmountToGive) {
            uint256 stablecoinPayment = paymentData.stablecoinAmountToReceive - paymentData.stablecoinAmountToGive;
            if (paymentData.collateralAmountToGive >= paymentData.collateralAmountToReceive) {
                // In the case where all amounts are null, the function will enter here and nothing will be done
                // for the repayment
                _handleRepay(
                    // Collateral payment is the difference between what to give and what to receive
                    paymentData.collateralAmountToGive - paymentData.collateralAmountToReceive,
                    stablecoinPayment,
                    from,
                    to,
                    who,
                    repayData
                );
            } else {
                if (stablecoinPayment > 0) stablecoin.burnFrom(stablecoinPayment, from, msg.sender);
                // In this case the collateral amount is necessarily non null
                collateral.safeTransferFrom(
                    msg.sender,
                    address(this),
                    paymentData.collateralAmountToReceive - paymentData.collateralAmountToGive
                );
            }
        } else {
            uint256 stablecoinPayment = paymentData.stablecoinAmountToGive - paymentData.stablecoinAmountToReceive;
            // `stablecoinPayment` is strictly positive in this case
            stablecoin.mint(to, stablecoinPayment);
            if (paymentData.collateralAmountToGive > paymentData.collateralAmountToReceive) {
                collateral.safeTransfer(to, paymentData.collateralAmountToGive - paymentData.collateralAmountToReceive);
            } else {
                uint256 collateralPayment = paymentData.collateralAmountToReceive - paymentData.collateralAmountToGive;
                if (collateralPayment > 0) {
                    if (repayData.length > 0) {
                        ISwapper(who).swap(
                            IERC20(address(stablecoin)),
                            collateral,
                            msg.sender,
                            stablecoinPayment,
                            collateralPayment,
                            repayData
                        );
                    }
                    collateral.safeTransferFrom(msg.sender, address(this), collateralPayment);
                }
            }
        }
    }

    /// @inheritdoc IVaultManagerFunctions
    function getDebtOut(
        uint256 vaultID,
        uint256 stablecoinAmount,
        uint256 senderBorrowFee
    ) external whenNotPaused {
        require(treasury.isVaultManager(msg.sender), "3");
        // Checking the delta of borrow fees to eliminate the risk of exploits here
        if (senderBorrowFee > borrowFee) {
            uint256 borrowFeePaid = ((senderBorrowFee - borrowFee) * stablecoinAmount) / BASE_PARAMS;
            stablecoinAmount -= borrowFeePaid;
            surplus += borrowFeePaid;
        }
        _repayDebt(vaultID, stablecoinAmount, 0);
    }

    // ============================= View Functions ================================

    /// @inheritdoc IVaultManagerFunctions
    function getVaultDebt(uint256 vaultID) external view returns (uint256) {
        return (vaultData[vaultID].normalizedDebt * _calculateCurrentInterestRateAccumulator()) / BASE_INTEREST;
    }

    /// @notice Gets the total debt across all vaults
    /// @return Total debt across all vaults, taking into account the interest accumulated
    /// over time
    function getTotalDebt() external view returns (uint256) {
        return (totalNormalizedDebt * _calculateCurrentInterestRateAccumulator()) / BASE_INTEREST;
    }

    /// @notice Checks whether a given vault is liquidable and if yes gives information regarding its liquidation
    /// @param vaultID ID of the vault to check
    /// @param liquidator Address of the liquidator which will be performing the liquidation
    /// @return liqOpp Description of the opportunity of liquidation
    /// @dev This function will revert if it's called on a vault that does not exist
    function checkLiquidation(uint256 vaultID, address liquidator)
        external
        view
        returns (LiquidationOpportunity memory liqOpp)
    {
        liqOpp = _checkLiquidation(
            vaultData[vaultID],
            liquidator,
            oracle.read(),
            _calculateCurrentInterestRateAccumulator()
        );
    }

    // =================== Internal Utility View Functions =========================

    /// @notice Verifies whether a given vault is solvent (i.e. should be liquidated or not)
    /// @param vault Data of the vault to check
    /// @param oracleValue Oracle value at the time of the call (it is in the base of the stablecoin, that is for agTokens 10**18)
    /// @param newInterestRateAccumulator Value of the `interestRateAccumulator` at the time of the call
    /// @return healthFactor Health factor of the vault: if it's inferior to 1 (`BASE_PARAMS` in fact) this means that the vault can be liquidated
    /// @return currentDebt Current value of the debt of the vault (taking into account interest)
    /// @return collateralAmountInStable Collateral in the vault expressed in stablecoin value
    /// @return oracleValue Current value of the oracle
    /// @return newInterestRateAccumulator Current value of the `interestRateAccumulator`
    /// @dev If the oracle value or the interest rate accumulator has not been called at the time of the
    /// call, this function computes it
    function _isSolvent(
        Vault memory vault,
        uint256 oracleValue,
        uint256 newInterestRateAccumulator
    )
        internal
        view
        returns (
            uint256,
            uint256,
            uint256,
            uint256,
            uint256
        )
    {
        if (oracleValue == 0) oracleValue = oracle.read();
        if (newInterestRateAccumulator == 0) newInterestRateAccumulator = _calculateCurrentInterestRateAccumulator();
        uint256 currentDebt = (vault.normalizedDebt * newInterestRateAccumulator) / BASE_INTEREST;
        uint256 collateralAmountInStable = (vault.collateralAmount * oracleValue) / _collatBase;
        uint256 healthFactor;
        if (currentDebt == 0) healthFactor = type(uint256).max;
        else healthFactor = (collateralAmountInStable * collateralFactor) / currentDebt;
        return (healthFactor, currentDebt, collateralAmountInStable, oracleValue, newInterestRateAccumulator);
    }

    /// @notice Calculates the current value of the `interestRateAccumulator` without updating the value
    /// in storage
    /// @dev This function avoids expensive exponentiation and the calculation is performed using a binomial approximation
    /// (1+x)^n = 1+n*x+[n/2*(n-1)]*x^2+[n/6*(n-1)*(n-2)*x^3...
    /// @dev The approximation slightly undercharges borrowers with the advantage of a great gas cost reduction
    /// @dev This function was mostly inspired from Aave implementation
    function _calculateCurrentInterestRateAccumulator() internal view returns (uint256) {
        uint256 exp = block.timestamp - lastInterestAccumulatorUpdated;
        uint256 ratePerSecond = interestRate;
        if (exp == 0 || ratePerSecond == 0) return interestAccumulator;
        uint256 expMinusOne = exp - 1;
        uint256 expMinusTwo = exp > 2 ? exp - 2 : 0;
        uint256 basePowerTwo = (ratePerSecond * ratePerSecond + HALF_BASE_INTEREST) / BASE_INTEREST;
        uint256 basePowerThree = (basePowerTwo * ratePerSecond + HALF_BASE_INTEREST) / BASE_INTEREST;
        uint256 secondTerm = (exp * expMinusOne * basePowerTwo) / 2;
        uint256 thirdTerm = (exp * expMinusOne * expMinusTwo * basePowerThree) / 6;
        return (interestAccumulator * (BASE_INTEREST + ratePerSecond * exp + secondTerm + thirdTerm)) / BASE_INTEREST;
    }

    // =============== Internal Utility State-Modifying Functions ==================

    /// @notice Closes a vault without handling the repayment of the concerned address
    /// @param vaultID ID of the vault to close
    /// @param oracleValueStart Oracle value at the start of the call: if it's 0 it's going to be computed
    /// in the `_isSolvent` function
    /// @param newInterestRateAccumulatorStart Interest rate accumulator value at the start of the call: if it's 0
    /// it's going to be computed in the `isSolvent` function
    /// @return Current debt of the vault to be repaid
    /// @return Value of the collateral in the vault to reimburse
    /// @return Current oracle value
    /// @return Current interest rate accumulator value
    /// @dev The returned values are here to facilitate composability between calls
    function _closeVault(
        uint256 vaultID,
        uint256 oracleValueStart,
        uint256 newInterestRateAccumulatorStart
    )
        internal
        onlyApprovedOrOwner(msg.sender, vaultID)
        returns (
            uint256,
            uint256,
            uint256,
            uint256
        )
    {
        Vault memory vault = vaultData[vaultID];
        // Optimize for gas here
        (
            uint256 healthFactor,
            uint256 currentDebt,
            ,
            uint256 oracleValue,
            uint256 newInterestRateAccumulator
        ) = _isSolvent(vault, oracleValueStart, newInterestRateAccumulatorStart);
        require(healthFactor > BASE_PARAMS, "21");
        _burn(vaultID);
        return (currentDebt, vault.collateralAmount, oracleValue, newInterestRateAccumulator);
    }

    /// @notice Increases the collateral balance of a vault
    /// @param vaultID ID of the vault to increase the collateral balance of
    /// @param collateralAmount Amount by which increasing the collateral balance of
    function _addCollateral(uint256 vaultID, uint256 collateralAmount) internal {
        vaultData[vaultID].collateralAmount += collateralAmount;
        emit CollateralAmountUpdated(vaultID, collateralAmount, 1);
    }

    /// @notice Decreases the collateral balance from a vault (without proceeding to collateral transfers)
    /// @param vaultID ID of the vault to decrease the collateral balance of
    /// @param collateralAmount Amount of collateral to reduce the balance of
    /// @param oracleValueStart Oracle value at the start of the call (given here to avoid double computations)
    /// @param interestRateAccumulatorStart Value of the interest rate accumulator (potentially zero if it has not been
    /// computed yet)
    /// @return Computed value of the oracle
    /// @return Computed value of the interest rate accumulator
    function _removeCollateral(
        uint256 vaultID,
        uint256 collateralAmount,
        uint256 oracleValueStart,
        uint256 interestRateAccumulatorStart
    ) internal onlyApprovedOrOwner(msg.sender, vaultID) returns (uint256, uint256) {
        vaultData[vaultID].collateralAmount -= collateralAmount;
        (uint256 healthFactor, , , uint256 oracleValue, uint256 newInterestRateAccumulator) = _isSolvent(
            vaultData[vaultID],
            oracleValueStart,
            interestRateAccumulatorStart
        );
        require(healthFactor > BASE_PARAMS, "21");
        emit CollateralAmountUpdated(vaultID, collateralAmount, 0);
        return (oracleValue, newInterestRateAccumulator);
    }

    /// @notice Increases the debt balance of a vault and takes into account borrowing fees
    /// @param vaultID ID of the vault to increase borrow balance of
    /// @param stablecoinAmount Amount of stablecoins to borrow
    /// @param oracleValueStart Oracle value at the start of the call (given here to avoid double computations)
    /// @param newInterestRateAccumulatorStart Value of the interest rate accumulator (potentially zero if it has not been
    /// computed yet)
    /// @return toMint Amount of stablecoins to mint
    /// @return oracleValue Computed value of the oracle
    /// @return interestRateAccumulator Computed value of the interest rate accumulator
    function _borrow(
        uint256 vaultID,
        uint256 stablecoinAmount,
        uint256 oracleValueStart,
        uint256 newInterestRateAccumulatorStart
    )
        internal
        onlyApprovedOrOwner(msg.sender, vaultID)
        returns (
            uint256 toMint,
            uint256 oracleValue,
            uint256 interestRateAccumulator
        )
    {
        (stablecoinAmount, oracleValue, interestRateAccumulator) = _increaseDebt(
            vaultID,
            stablecoinAmount,
            oracleValueStart,
            newInterestRateAccumulatorStart
        );
        uint256 borrowFeePaid = (borrowFee * stablecoinAmount) / BASE_PARAMS;
        surplus += borrowFeePaid;
        toMint = stablecoinAmount - borrowFeePaid;
    }

    /// @notice Gets debt in a vault from another vault potentially in another `VaultManager` contract
    /// @param srcVaultID ID of the vault from this contract for which growing debt
    /// @param vaultManager Address of the `vaultManager` where the targeted vault is
    /// @param dstVaultID ID of the vault in the target contract
    /// @param stablecoinAmount Amount of stablecoins to grow the debt of. This amount will be converted
    /// to a normalized value in both vaultManager contracts
    /// @param oracleValue Oracle value at the start of the call (potentially zero if it has not been computed yet)
    /// @param newInterestRateAccumulator Value of the interest rate accumulator (potentially zero if it has not been
    /// computed yet)
    /// @dev A solvency check is performed after the debt increase in the source `vaultID`
    /// @dev Only approved addresses by the source vault owner can perform this action, however any vault
    /// from any vaultManager contract can see its debt reduced by this means
    /// @return Computed value of the oracle
    /// @return Computed value of the interest rate accumulator
    function _getDebtIn(
        uint256 srcVaultID,
        IVaultManager vaultManager,
        uint256 dstVaultID,
        uint256 stablecoinAmount,
        uint256 oracleValue,
        uint256 newInterestRateAccumulator
    ) internal onlyApprovedOrOwner(msg.sender, srcVaultID) returns (uint256, uint256) {
        // The `stablecoinAmount` needs to be rounded down in the `_increaseDebt` function to reduce the room for exploits
        (stablecoinAmount, oracleValue, newInterestRateAccumulator) = _increaseDebt(
            srcVaultID,
            stablecoinAmount,
            oracleValue,
            newInterestRateAccumulator
        );
        if (address(vaultManager) == address(this)) {
            _repayDebt(dstVaultID, stablecoinAmount, newInterestRateAccumulator);
        } else {
            /* No need to check the integrity of `vaultManager` here because `_getDebtIn` can be entered only through the
            `angle` function which is non reentrant. Also, `getDebtOut` failing would be at the attacker loss, as he
            would get his debt increasing in the current vault without decreasing it in the remote vault.
            */
            vaultManager.getDebtOut(dstVaultID, stablecoinAmount, borrowFee);
        }
        return (oracleValue, newInterestRateAccumulator);
    }

    /// @notice Increases the debt of a given vault and verifies that this vault is still solvent
    /// @param vaultID ID of the vault to increase the debt of
    /// @param stablecoinAmount Amount of stablecoin to increase the debt of: this amount is converted in
    /// normalized debt using the pre-computed (or not) `newInterestRateAccumulator` value
    /// @param oracleValueStart Oracle value at the start of the call (given here to avoid double computations)
    /// @param newInterestRateAccumulator Value of the interest rate accumulator (potentially zero if it has not been
    /// computed yet)
    /// @return Amount of stablecoins to issue from this debt increase
    /// @return Computed value of the oracle
    /// @return Computed value of the interest rate accumulator
    /// @dev The `stablecoinAmount` outputted need to be rounded down with respect to the change amount so that
    /// amount of stablecoins minted is smaller than the debt increase
    function _increaseDebt(
        uint256 vaultID,
        uint256 stablecoinAmount,
        uint256 oracleValueStart,
        uint256 newInterestRateAccumulator
    )
        internal
        returns (
            uint256,
            uint256,
            uint256
        )
    {
        if (newInterestRateAccumulator == 0) newInterestRateAccumulator = _calculateCurrentInterestRateAccumulator();
        /* We normalize the amount by dividing it by `newInterestRateAccumulator`. This makes accounting easier, since
        it allows us to process all (past and future) debts like debts created at the inception of the contract. */
        uint256 changeAmount = (stablecoinAmount * BASE_INTEREST) / newInterestRateAccumulator;
        // if there was no previous debt, we have to check that the debt creation will be higher than `dust`
        if (vaultData[vaultID].normalizedDebt == 0)
            require(changeAmount * newInterestRateAccumulator > dust * BASE_INTEREST, "24");
        vaultData[vaultID].normalizedDebt += changeAmount;
        totalNormalizedDebt += changeAmount;
        require(totalNormalizedDebt * newInterestRateAccumulator <= debtCeiling * BASE_INTEREST, "45");
        (uint256 healthFactor, , , uint256 oracleValue, ) = _isSolvent(
            vaultData[vaultID],
            oracleValueStart,
            newInterestRateAccumulator
        );
        require(healthFactor > BASE_PARAMS, "21");
        emit InternalDebtUpdated(vaultID, changeAmount, 1);
        return ((changeAmount * newInterestRateAccumulator) / BASE_INTEREST, oracleValue, newInterestRateAccumulator);
    }

    /// @notice Decreases the debt of a given vault and verifies that this vault still has an amount of debt superior
    /// to a dusty amount or no debt at all
    /// @param vaultID ID of the vault to decrease the debt of
    /// @param stablecoinAmount Amount of stablecoin to decrease the debt of: this amount is converted in
    /// normalized debt using the pre-computed (or not) `newInterestRateAccumulator` value
    /// To repay the whole debt, one can pass `type(uint256).max`
    /// @param newInterestRateAccumulator Value of the interest rate accumulator (potentially zero if it has not been
    /// computed yet)
    /// @return Amount of stablecoins to be burnt to correctly repay the debt
    /// @return Computed value of the interest rate accumulator
    /// @dev If `stablecoinAmount` is `type(uint256).max`, this function will repay all the debt of the vault
    function _repayDebt(
        uint256 vaultID,
        uint256 stablecoinAmount,
        uint256 newInterestRateAccumulator
    ) internal returns (uint256, uint256) {
        if (newInterestRateAccumulator == 0) newInterestRateAccumulator = _calculateCurrentInterestRateAccumulator();
        uint256 newVaultNormalizedDebt = vaultData[vaultID].normalizedDebt;
        // To save one variable declaration, `changeAmount` is first expressed in stablecoin amount before being converted
        // to a normalized amount. Here we first store the maximum amount that can be repaid given the current debt
        uint256 changeAmount = (newVaultNormalizedDebt * newInterestRateAccumulator) / BASE_INTEREST;
        // In some situations (e.g. liquidations), the `stablecoinAmount` is rounded above and we want to make
        // sure to avoid underflows in all situations
        if (stablecoinAmount >= changeAmount) {
            stablecoinAmount = changeAmount;
            changeAmount = newVaultNormalizedDebt;
        } else {
            changeAmount = (stablecoinAmount * BASE_INTEREST) / newInterestRateAccumulator;
        }
        newVaultNormalizedDebt -= changeAmount;
        totalNormalizedDebt -= changeAmount;
        require(
            newVaultNormalizedDebt == 0 || newVaultNormalizedDebt * newInterestRateAccumulator > dust * BASE_INTEREST,
            "24"
        );
        vaultData[vaultID].normalizedDebt = newVaultNormalizedDebt;
        emit InternalDebtUpdated(vaultID, changeAmount, 0);
        return (stablecoinAmount, newInterestRateAccumulator);
    }

    /// @notice Handles the simultaneous repayment of stablecoins with a transfer of collateral
    /// @param collateralAmountToGive Amount of collateral the contract should give
    /// @param stableAmountToRepay Amount of stablecoins the contract should burn from the call
    /// @param from Address from which stablecoins should be burnt: it should be the `msg.sender` or at least
    /// approved by it
    /// @param to Address to which stablecoins should be sent
    /// @param who Address which should be notified if needed of the transfer
    /// @param data Data to pass to the `who` contract for it to successfully give the correct amount of stablecoins
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
                ISwapper(who).swap(
                    collateral,
                    IERC20(address(stablecoin)),
                    from,
                    stableAmountToRepay,
                    collateralAmountToGive,
                    data
                );
            }
            stablecoin.burnFrom(stableAmountToRepay, from, msg.sender);
        }
    }

    // =================== Treasury Relationship Functions =========================

    /// @inheritdoc IVaultManagerFunctions
    function accrueInterestToTreasury() external onlyTreasury returns (uint256 surplusValue, uint256 badDebtValue) {
        _accrue();
        surplusValue = surplus;
        badDebtValue = badDebt;
        if (surplusValue >= badDebtValue) {
            surplusValue -= badDebtValue;
            badDebtValue = 0;
            stablecoin.mint(address(treasury), surplusValue);
        } else {
            badDebtValue -= surplusValue;
            surplusValue = 0;
        }
        surplus = 0;
        badDebt = 0;
        emit AccruedToTreasury(surplusValue, badDebtValue);
    }

    /// @notice Accrues interest accumulated across all vaults to the surplus
    /// @dev This function updates the `interestAccumulator`
    /// @dev It should also be called when updating the value of the per second interest rate
    function _accrue() internal {
        uint256 newInterestRateAccumulator = _calculateCurrentInterestRateAccumulator();
        uint256 interestAccrued = (totalNormalizedDebt * (newInterestRateAccumulator - interestAccumulator)) /
            BASE_INTEREST;
        surplus += interestAccrued;
        interestAccumulator = newInterestRateAccumulator;
        lastInterestAccumulatorUpdated = block.timestamp;
        emit InterestRateAccumulatorUpdated(newInterestRateAccumulator, block.timestamp);
    }

    // ============================ Liquidations ===================================

    /// @notice Liquidates an ensemble of vaults specified by their IDs
    /// @param vaultIDs List of the vaults to liquidate
    /// @param amounts Amount of stablecoin to bring for the liquidation of each vault
    /// @param from Address from which the stablecoins for the liquidation should be taken: this address should be the `msg.sender`
    /// or have received an approval
    /// @param to Address to which discounted collateral should be sent
    /// @dev This function will not revert if it's called on a vault that cannot be liquidated
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
    /// @param amounts Amount of stablecoin to bring for the liquidation of each vault
    /// @param from Address from which the stablecoins for the liquidation should be taken: this address should be the `msg.sender`
    /// or have received an approval
    /// @param to Address to which discounted collateral should be sent
    /// @param who Address of the contract to handle repayment of stablecoins from received collateral
    /// @param data Data to pass to the repayment contract in case of
    /// @dev This function will revert if it's called on a vault that cannot be liquidated or that does not exist
    function liquidate(
        uint256[] memory vaultIDs,
        uint256[] memory amounts,
        address from,
        address to,
        address who,
        bytes memory data
    ) public whenNotPaused nonReentrant returns (LiquidatorData memory liqData) {
        // Stores all the data about an ongoing liquidation of multiple vaults
        require(vaultIDs.length == amounts.length, "25");
        liqData.oracleValue = oracle.read();
        liqData.newInterestRateAccumulator = _calculateCurrentInterestRateAccumulator();
        for (uint256 i = 0; i < vaultIDs.length; i++) {
            Vault memory vault = vaultData[vaultIDs[i]];
            // Computing if liquidation can take place for a vault
            LiquidationOpportunity memory liqOpp = _checkLiquidation(
                vault,
                msg.sender,
                liqData.oracleValue,
                liqData.newInterestRateAccumulator
            );

            // Makes sure not to leave a dusty amount in the vault by either not liquidating too much
            // or everything
            if (
                (liqOpp.thresholdRepayAmount > 0 && amounts[i] > liqOpp.thresholdRepayAmount) ||
                amounts[i] > liqOpp.maxStablecoinAmountToRepay
            ) amounts[i] = liqOpp.maxStablecoinAmountToRepay;

            // liqOpp.discount stores in fact `1-discount`
            uint256 collateralReleased = (amounts[i] * BASE_PARAMS * _collatBase) /
                (liqOpp.discount * liqData.oracleValue);
            // Because we're rounding up in some divisions, `collateralReleased` can be greater than the `collateralAmount` of the vault
            // In this case, `stablecoinAmountToReceive` is still rounded up
            if (vault.collateralAmount <= collateralReleased) {
                collateralReleased = vault.collateralAmount;
                // Reinitializing the `vaultID`: we're not burning the vault in this case for integration purposes
                delete vaultData[vaultIDs[i]];
                liqData.badDebtFromLiquidation +=
                    liqOpp.currentDebt -
                    (amounts[i] * liquidationSurcharge) /
                    BASE_PARAMS;
                // There may be an edge case in which: `amounts[i] = (currentDebt * BASE_PARAMS) / surcharge + 1`
                // In this case, as long as `surcharge < BASE_PARAMS`, there cannot be any underflow in the operation
                // above
            } else {
                vaultData[vaultIDs[i]].collateralAmount -= collateralReleased;
                // In the case where the full debt is being repaid, `amounts[i]` must be rounded above
                _repayDebt(
                    vaultIDs[i],
                    (amounts[i] * liquidationSurcharge) / BASE_PARAMS,
                    liqData.newInterestRateAccumulator
                );
            }
            liqData.collateralAmountToGive += collateralReleased;
            liqData.stablecoinAmountToReceive += amounts[i];
        }
        // Normalization of good and bad debt is already handled in the `_accrue` function
        surplus += (liqData.stablecoinAmountToReceive * (BASE_PARAMS - liquidationSurcharge)) / BASE_PARAMS;
        badDebt += liqData.badDebtFromLiquidation;
        _handleRepay(liqData.collateralAmountToGive, liqData.stablecoinAmountToReceive, from, to, who, data);
    }

    /// @notice Internal version of the `checkLiquidation` function
    /// @dev This function takes two additional parameters as when entering this function `oracleValue`
    /// and `newInterestRateAccumulator` should have always been computed
    function _checkLiquidation(
        Vault memory vault,
        address liquidator,
        uint256 oracleValue,
        uint256 newInterestRateAccumulator
    ) internal view returns (LiquidationOpportunity memory liqOpp) {
        // Checking if the vault can be liquidated
        (uint256 healthFactor, uint256 currentDebt, uint256 collateralAmountInStable, , ) = _isSolvent(
            vault,
            oracleValue,
            newInterestRateAccumulator
        );
        // Health factor of a vault that does not exist is `type(uint256).max`
        require(healthFactor < BASE_PARAMS, "44");

        uint256 liquidationDiscount = (_computeLiquidationBoost(liquidator) * (BASE_PARAMS - healthFactor)) /
            BASE_PARAMS;
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
        // In the first case, the health factor is an increasing function of the stablecoin amount to repay,
        // this means that the liquidator can bring the vault to the target health ratio
        if (healthFactor * liquidationDiscount * surcharge >= collateralFactor * BASE_PARAMS**2) {
            // This is the max amount to repay that will bring the person to the target health factor
            // Denom is always positive when a vault gets liquidated in this case and when the health factor
            // is an increasing function of the amount of stablecoins repaid
            // And given that most parameters are in base 9, the numerator can very hardly overflow here
            maxAmountToRepay =
                ((targetHealthFactor * currentDebt - collateralAmountInStable * collateralFactor) *
                    BASE_PARAMS *
                    liquidationDiscount) /
                (surcharge * targetHealthFactor * liquidationDiscount - (BASE_PARAMS**2) * collateralFactor);
            // The quantity below tends to be rounded in the above direction, which means that governance should
            // set the `targetHealthFactor` accordingly
            // Need to check for the dust: liquidating should not leave a dusty amount in the vault
            if (currentDebt <= (maxAmountToRepay * surcharge) / BASE_PARAMS + dust) {
                // If liquidating to the target threshold would leave a dusty amount: the liquidator can repay all
                // We're rounding up the max amount to repay to make sure all the debt ends up being paid
                // and we're computing again the real value of the debt to avoid propagation of rounding errors
                maxAmountToRepay =
                    (vault.normalizedDebt * newInterestRateAccumulator * BASE_PARAMS) /
                    (surcharge * BASE_INTEREST) +
                    1;
                // In this case the threshold amount is such that it leaves just enough dust
                // This line cannot underflow as long as the  `dust` parameter is constant: it is always checked that
                // the debt is greater than the  `dust`. If the  `dust` was to increase due to an implementation upgrade
                // we would need to add some extra checks to avoid underflows
                // Here the `thresholdRepayAmount` is also rounded down: which means that if a liquidator repays this amount
                // then there would be more than `dust` left in the vault
                thresholdRepayAmount = ((currentDebt - dust) * BASE_PARAMS) / surcharge;
            }
        } else {
            // In all cases the liquidator can repay stablecoins such that they'll end up getting exactly the collateral
            // in the liquidated vault
            // Rounding up to make sure all gets liquidated in this case: the liquidator will never get more than the collateral
            // amount in the vault however: we're performing the computation of the `collateralAmountInStable` again to avoid
            // propagation of rounding errors
            maxAmountToRepay =
                (vault.collateralAmount * liquidationDiscount * oracleValue) /
                (BASE_PARAMS * _collatBase) +
                1;
            // It should however make sure not to leave a dusty amount of collateral (in stablecoin value) in the vault
            if (collateralAmountInStable > _dustCollateral)
                // There's no issue with this amount being rounded down
                thresholdRepayAmount =
                    ((collateralAmountInStable - _dustCollateral) * liquidationDiscount) /
                    BASE_PARAMS;
                // If there is from the beginning a dusty amount of collateral, liquidator should repay everything that's left
            else thresholdRepayAmount = maxAmountToRepay;
        }
        liqOpp.maxStablecoinAmountToRepay = maxAmountToRepay;
        liqOpp.maxCollateralAmountGiven =
            (maxAmountToRepay * BASE_PARAMS * _collatBase) /
            (oracleValue * liquidationDiscount);
        liqOpp.thresholdRepayAmount = thresholdRepayAmount;
        liqOpp.discount = liquidationDiscount;
        liqOpp.currentDebt = currentDebt;
    }

    /// @notice Computes the liquidation boost of a given address, that is the slope of the discount function
    /// @param liquidator Address for which boost should be computed
    /// @return The slope of the discount function
    function _computeLiquidationBoost(address liquidator) internal view returns (uint256) {
        if (address(veBoostProxy) == address(0)) {
            return yLiquidationBoost[0];
        } else {
            uint256 adjustedBalance = veBoostProxy.adjusted_balance_of(liquidator);
            if (adjustedBalance >= xLiquidationBoost[1]) return yLiquidationBoost[1];
            else if (adjustedBalance <= xLiquidationBoost[0]) return yLiquidationBoost[0];
            else
                return
                    yLiquidationBoost[0] +
                    ((yLiquidationBoost[1] - yLiquidationBoost[0]) * (adjustedBalance - xLiquidationBoost[0])) /
                    (xLiquidationBoost[1] - xLiquidationBoost[0]);
        }
    }

    // ============================== Setters ======================================

    /// @notice Sets parameters encoded as uint64
    /// @param param Value for the parameter
    /// @param what Parameter to change
    /// @dev This function performs the required checks when updating a parameter
    /// @dev When setting parameters governance should make sure that when `HF < CF/((1-surcharge)(1-discount))`
    /// and hence when liquidating a vault is going to decrease its health factor, `discount = max discount`.
    /// Otherwise, it may be profitable for the liquidator to liquidate in multiple times: as it will decrease
    /// the HF and therefore increase the discount between each time
    function setUint64(uint64 param, bytes32 what) external onlyGovernorOrGuardian {
        if (what == "collateralFactor") {
            require(param <= liquidationSurcharge, "9");
            collateralFactor = param;
        } else if (what == "targetHealthFactor") {
            require(param >= BASE_PARAMS, "17");
            targetHealthFactor = param;
        } else if (what == "borrowFee") {
            require(param <= BASE_PARAMS, "9");
            borrowFee = param;
        } else if (what == "interestRate") {
            _accrue();
            interestRate = param;
        } else if (what == "liquidationSurcharge") {
            require(collateralFactor <= param && param <= BASE_PARAMS, "18");
            liquidationSurcharge = param;
        } else if (what == "maxLiquidationDiscount") {
            require(param < BASE_PARAMS, "9");
            maxLiquidationDiscount = param;
        } else {
            revert("43");
        }
        emit FiledUint64(param, what);
    }

    /// @notice Sets `debtCeiling`
    /// @param _debtCeiling New value for `debtCeiling`
    function setDebtCeiling(uint256 _debtCeiling) external onlyGovernorOrGuardian {
        debtCeiling = _debtCeiling;
        emit DebtCeilingUpdated(_debtCeiling);
    }

    /// @notice Sets the parameters for the liquidation booster which encodes the slope of the discount
    /// @param _veBoostProxy Address which queries veANGLE balances and adjusted balances from delegation
    /// @param xBoost Threshold values of veANGLE adjusted balances
    /// @param yBoost Values of the liquidation boost at the threshold values of x
    /// @dev There are 2 modes:
    /// When boost is enabled, `xBoost` and `yBoost` should have a length of 2, but if they have a
    /// higher length contract will still work as expected. Contract will also work as expected if their
    /// length differ
    /// When boost is disabled, `_veBoostProxy` needs to be zero address and `yBoost[0]` is the base boost
    function setLiquidationBoostParameters(
        address _veBoostProxy,
        uint256[] memory xBoost,
        uint256[] memory yBoost
    ) external onlyGovernorOrGuardian {
        require(
            (xBoost.length == yBoost.length) &&
                (yBoost[0] > 0) &&
                ((_veBoostProxy == address(0)) || (xBoost[1] > xBoost[0] && yBoost[1] >= yBoost[0])),
            "15"
        );
        veBoostProxy = IVeBoostProxy(_veBoostProxy);
        xLiquidationBoost = xBoost;
        yLiquidationBoost = yBoost;
        emit LiquidationBoostParametersUpdated(_veBoostProxy, xBoost, yBoost);
    }

    /// @notice Toggles permission for owning vaults by any account
    function toggleWhitelisting() external onlyGovernor {
        bool flag = !whitelistingActivated;
        whitelistingActivated = flag;
        emit ToggledWhitelisting(flag);
    }

    /// @notice Changes the reference to the oracle contract used to get the price of the oracle
    /// @param _oracle Reference to the oracle contract
    function setOracle(address _oracle) external onlyGovernor {
        require(IOracle(_oracle).treasury() == treasury, "33");
        oracle = IOracle(_oracle);
        emit OracleUpdated(_oracle);
    }

    /// @inheritdoc IVaultManagerFunctions
    function setTreasury(address _treasury) external onlyTreasury {
        treasury = ITreasury(_treasury);
        // This function makes sure to propagate the change to the associated contract
        // even though a single oracle contract could be used in different places
        oracle.setTreasury(_treasury);
    }

    /// @notice Changes the whitelisting of an address
    /// @param target Address to toggle
    function toggleWhitelist(address target) external onlyGovernor {
        isWhitelisted[target] = !isWhitelisted[target];
    }

    /// @notice Pauses external permissionless functions of the contract
    function togglePause() external onlyGovernorOrGuardian {
        paused = !paused;
    }

    /// @notice Changes the ERC721 metadata URI
    function setBaseURI(string memory baseURI_) external onlyGovernorOrGuardian {
        _baseURI = baseURI_;
    }
}
