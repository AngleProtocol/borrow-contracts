// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

import "./VaultManagerERC721.sol";

// TODO think about exporting things to libraries to make it more practical
// TODO reentrancy calls here -> should we put more and where to make sure we are not vulnerable to hacks here
// the thing is that in the handle repay we are exposed to reentrancy attacks because people can call any other function
// but I can't find a circuit where there is an exploit at the moment since the only thing that normally follow after
// this call are
// TODO in the handleRepay: do we impose restrictions on the called addresses like Maker does here or is there no point
// in doing it: https://github.com/makerdao/dss/blob/master/src/clip.sol
// TODO think of more (or less) view functions -> cf Picodes
// TODO Events double check
//TODO If enough space add recoverERC20
// TODO Decide if we want to keep pause: size is 0.83
// TODO Add native support for permit ?

/// @title VaultManager
/// @author Angle Core Team
/// @notice This contract allows people to deposit collateral and open up loans of a given AgToken. It handles all the loan
/// logic (fees and interest rate) as well as the liquidation logic
/// @dev This implementation only supports non-rebasing ERC20 tokens as collateral
/// @dev This contract is encoded as a NFT contract
// solhint-disable-next-line max-states-count
contract VaultManager is VaultManagerERC721, IVaultManagerFunctions {
    using SafeERC20 for IERC20;
    using Address for address;

    /// @notice Initializes the `VaultManager` contract
    /// @param _treasury Treasury address handling the contract
    /// @param _collateral Collateral supported by this contract
    /// @param _oracle Oracle contract used
    /// @dev The parameters and the oracle are the only elements which could be modified once the
    /// contract has been initialized
    /// @dev For the contract to be fully initialized, governance needs to set the parameters for the liquidation
    /// boost
    function initialize(
        ITreasury _treasury,
        IERC20 _collateral,
        IOracle _oracle,
        VaultParameters calldata params
    ) public initializer {
        require(_oracle.treasury() == _treasury, "33");
        treasury = _treasury;
        collateral = _collateral;
        _collatBase = 10**(IERC20Metadata(address(collateral)).decimals());
        stablecoin = IAgToken(_treasury.stablecoin());
        oracle = _oracle;

        string memory fetchedSymbol = string.concat(
            IERC20Metadata(address(collateral)).symbol(),
            "/",
            IERC20Metadata(address(stablecoin)).symbol()
        );
        name = string.concat("Angle Protocol ", fetchedSymbol, " Vault");
        symbol = string.concat(fetchedSymbol, "-vault");

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
    constructor(uint256 _dust, uint256 _dustCollateral) VaultManagerStorage(_dust, _dustCollateral) {}

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
                newInterestRateAccumulator = _repayDebt(vaultID, collateralAmount, newInterestRateAccumulator);
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
                if (repayData.length > 0 && collateralPayment > 0) {
                    IRepayCallee(who).repayCallCollateral(msg.sender, stablecoinPayment, collateralPayment, repayData);
                } else if (collateralPayment > 0)
                    collateral.safeTransferFrom(msg.sender, address(this), collateralPayment);
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
        (oracleValue, interestRateAccumulator) = _increaseDebt(
            vaultID,
            stablecoinAmount,
            oracleValueStart,
            newInterestRateAccumulatorStart
        );
        uint256 borrowFeePaid = (borrowFee * stablecoinAmount) / BASE_PARAMS;
        surplus += borrowFeePaid;
        toMint = stablecoinAmount - borrowFeePaid;
    }

    /// @notice Internal version of the `getDebtIn` function
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
        if (address(vaultManager) == address(this)) {
            _repayDebt(dstVaultID, stablecoinAmount, newInterestRateAccumulator);
        } else {
            require(treasury.isVaultManager(address(vaultManager)), "22");
            vaultManager.getDebtOut(dstVaultID, stablecoinAmount, borrowFee);
        }
        return _increaseDebt(srcVaultID, stablecoinAmount, oracleValue, newInterestRateAccumulator);
    }

    /// @notice Increases the debt of a given vault and verifies that this vault is still solvent
    /// @param vaultID ID of the vault to increase the debt of
    /// @param stablecoinAmount Amount of stablecoin to increase the debt of: this amount is converted in
    /// normalized debt using the pre-computed (or not) `newInterestRateAccumulator` value
    /// @param oracleValueStart Oracle value at the start of the call (given here to avoid double computations)
    /// @param newInterestRateAccumulator Value of the interest rate accumulator (potentially zero if it has not been
    /// computed yet)
    /// @return Computed value of the oracle
    /// @return Computed value of the interest rate accumulator
    function _increaseDebt(
        uint256 vaultID,
        uint256 stablecoinAmount,
        uint256 oracleValueStart,
        uint256 newInterestRateAccumulator
    ) internal returns (uint256, uint256) {
        if (newInterestRateAccumulator == 0) newInterestRateAccumulator = _calculateCurrentInterestRateAccumulator();
        uint256 changeAmount = (stablecoinAmount * BASE_INTEREST) / newInterestRateAccumulator; // TODO Rounding imprecision in favor of borrower: one could borrow 1
        if (vaultData[vaultID].normalizedDebt == 0) require(stablecoinAmount > dust, "24");
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
        return (oracleValue, newInterestRateAccumulator);
    }

    /// @notice Decreases the debt of a given vault and verifies that this vault still has an amount of debt superior
    /// to a dusty amount or no debt at all
    /// @param vaultID ID of the vault to decrease the debt of
    /// @param stablecoinAmount Amount of stablecoin to increase the debt of: this amount is converted in
    /// normalized debt using the pre-computed (or not) `newInterestRateAccumulator` value
    /// @param newInterestRateAccumulator Value of the interest rate accumulator (potentially zero if it has not been
    /// computed yet)
    /// @return Computed value of the interest rate accumulator
    function _repayDebt(
        uint256 vaultID,
        uint256 stablecoinAmount,
        uint256 newInterestRateAccumulator
    ) internal returns (uint256) {
        if (newInterestRateAccumulator == 0) newInterestRateAccumulator = _calculateCurrentInterestRateAccumulator();
        uint256 changeAmount = (stablecoinAmount * BASE_INTEREST) / newInterestRateAccumulator;
        uint256 newVaultNormalizedDebt = vaultData[vaultID].normalizedDebt - changeAmount;
        totalNormalizedDebt -= changeAmount;
        require(
            newVaultNormalizedDebt == 0 || newVaultNormalizedDebt * newInterestRateAccumulator >= dust * BASE_INTEREST,
            "24"
        );
        vaultData[vaultID].normalizedDebt = newVaultNormalizedDebt;
        emit InternalDebtUpdated(vaultID, changeAmount, 0);
        return newInterestRateAccumulator;
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
        if (data.length > 0 && stableAmountToRepay > 0) {
            IRepayCallee(who).repayCallStablecoin(from, stableAmountToRepay, collateralAmountToGive, data);
            stablecoin.burnFrom(stableAmountToRepay, from, msg.sender);
        } else if (stableAmountToRepay > 0) stablecoin.burnFrom(stableAmountToRepay, from, msg.sender);
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
    ) external {
        liquidate(vaultIDs, amounts, from, to, address(0), new bytes(0));
    }

    /// @notice Liquidates an ensemble of vaults specified by their IDs
    /// @param vaultIDs List of the vaults to liquidate
    /// @param amounts Amount of stablecoin to bring for the liquidation of each vault
    /// @param from Address from which the stablecoins for the liquidation should be taken: this address should be the `msg.sender`
    /// or have received an approval
    /// @param to Address to which discounted collateral should be sent
    /// @param who Address of the contract to handle repayment of stablecoins from received collateral
    /// @param data Data to pass to the repayment contract in case of
    /// @dev This function will not revert if it's called on a vault that cannot be liquidated
    function liquidate(
        uint256[] memory vaultIDs,
        uint256[] memory amounts,
        address from,
        address to,
        address who,
        bytes memory data
    ) public whenNotPaused nonReentrant {
        // Stores all the data about an ongoing liquidation of multiple vaults
        LiquidatorData memory liqData;
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

            require(
                (liqOpp.maxStablecoinAmountToRepay > 0) && // Vault should be liquidable
                    // And liquidator should not reimburse more than what can be reimbursed
                    ((liqOpp.thresholdRepayAmount == 0 && amounts[i] <= liqOpp.maxStablecoinAmountToRepay) ||
                        // Or it should make sure not to leave a dusty amount in the vault by either not liquidating too much
                        // or everything
                        (liqOpp.thresholdRepayAmount != 0 &&
                            (amounts[i] == liqOpp.maxStablecoinAmountToRepay ||
                                amounts[i] <= liqOpp.thresholdRepayAmount))),
                "41"
            );
            // liqOpp.discount stores in fact `1-discount`
            uint256 collateralReleased = (amounts[i] * BASE_PARAMS * _collatBase) /
                (liqOpp.discount * liqData.oracleValue);
            liqData.collateralAmountToGive += collateralReleased;
            liqData.stablecoinAmountToReceive += amounts[i];

            // `collateralReleased` cannot be greater than the `collateralAmount` of the vault if the amount provided
            // by the liquidator is inferior to the `maxStablecoinAmountToRepay`
            if (vault.collateralAmount == collateralReleased) {
                // Reinitializing the `vaultID`: we're not burning the vault in this case for integration purposes
                delete vaultData[vaultIDs[i]];
                liqData.badDebtFromLiquidation +=
                    liqOpp.currentDebt -
                    (amounts[i] * liquidationSurcharge) /
                    BASE_PARAMS;
            } else {
                vaultData[vaultIDs[i]].collateralAmount -= collateralReleased;
                _repayDebt(
                    vaultIDs[i],
                    (amounts[i] * liquidationSurcharge) / BASE_PARAMS,
                    liqData.newInterestRateAccumulator
                );
            }
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
        require(healthFactor < BASE_PARAMS, "44");

        uint256 liquidationDiscount = (_computeLiquidationBoost(liquidator) * (BASE_PARAMS - healthFactor)) /
            BASE_PARAMS;
        // In fact `liquidationDiscount` is stored here as 1 minus discount to save some computation costs
        liquidationDiscount = liquidationDiscount >= maxLiquidationDiscount
            ? BASE_PARAMS - maxLiquidationDiscount
            : BASE_PARAMS - liquidationDiscount;
        // Same for the surcharge here: it's in fact 1 - the fee taken by the protocol
        uint256 surcharge = liquidationSurcharge;
        // Checking if we're in a situation where the health factor is an increasing or a decreasing function of the
        // amount repaid
        uint256 maxAmountToRepay;
        uint256 thresholdRepayAmount = 0;
        // In the first case, the health factor is an increasing function of the stablecoin amount to repay,
        // this means that the liquidator can bring the vault to the target health ratio
        if (healthFactor * liquidationDiscount * surcharge >= collateralFactor * BASE_PARAMS**2) {
            // This is the max amount to repay that will bring the person to the target health factor
            // Denom is always positive when a vault gets liquidated in this case and when the health factor
            // is an increasing function of the amount of stablecoins repaid
            maxAmountToRepay = // TODO somehow rounding in the wrong direction
                ((targetHealthFactor * currentDebt - collateralAmountInStable * collateralFactor) * BASE_PARAMS) /
                (surcharge * targetHealthFactor - ((BASE_PARAMS**2) * collateralFactor) / liquidationDiscount);
            // Need to check for the dust: liquidating should not leave a dusty amount in the vault
            if (currentDebt <= (maxAmountToRepay * surcharge) / BASE_PARAMS + dust) {
                // If liquidating to the target threshold would leave a dusty amount: the liquidator can repay all
                maxAmountToRepay = (currentDebt * BASE_PARAMS) / surcharge;
                // In this case the threshold amount is such that it leaves just enough dust
                thresholdRepayAmount = ((currentDebt - dust) * BASE_PARAMS) / surcharge; // TODO Line could underflow
            }
        } else {
            // In all cases the liquidator can repay stablecoins such that they'll end up getting exactly the collateral
            // in the liquidated vault
            maxAmountToRepay = (collateralAmountInStable * liquidationDiscount) / BASE_PARAMS;
            // It should however make sure not to leave a dusty amount of collateral (in stablecoin value) in the vault
            if (collateralAmountInStable > dustCollateral)
                thresholdRepayAmount =
                    ((collateralAmountInStable - dustCollateral) * liquidationDiscount) /
                    BASE_PARAMS;
                // If there is from the beginning a dusty amount of collateral, liquidator should repay everything that's left
            else thresholdRepayAmount = maxAmountToRepay;
        }
        liqOpp.maxStablecoinAmountToRepay = maxAmountToRepay;
        // TODO double check -> Cannot divide by 0 as liquidationDiscount > 0
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
    /// higher length contract will still work as expected
    /// When boost is disabled, `_veBoostProxy` needs to be zero address and `yBoost[0]` is the base boost
    function setLiquidationBoostParameters(
        address _veBoostProxy,
        uint256[] memory xBoost,
        uint256[] memory yBoost
    ) external onlyGovernorOrGuardian {
        require(
            (_veBoostProxy == address(0) && yBoost[0] > 0) ||
                (yBoost.length == xBoost.length && yBoost[0] > 0 && xBoost[1] > xBoost[0] && yBoost[1] >= yBoost[0]),
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
