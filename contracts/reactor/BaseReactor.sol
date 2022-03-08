// SPDX-License-Identifier: AGPL-3.0-only

pragma solidity 0.8.12;

import "./BaseReactorStorage.sol";

/// @title BaseReactor
/// @notice Reactor for using a token as collateral for agTokens. ERC4646 tokenized Vault implementation.
/// @author Angle Core Team, based on Solmate (https://github.com/Rari-Capital/solmate/blob/main/src/mixins/ERC4626.sol)
/// @dev A token used as an asset built to exploit this reactor could perform reentrancy attacks if not enough checks
/// are performed: as such the protocol implements reentrancy checks on all external entry point
abstract contract BaseReactor is BaseReactorStorage, ERC20Upgradeable, IERC721ReceiverUpgradeable, IERC4626 {
    using SafeERC20 for IERC20;

    /// @notice Initializes the `BaseReactor` contract and
    /// the underlying `VaultManager`
    /// @param _name Name of the ERC4626 token
    /// @param _symbol Symbol of the ERC4626 token
    /// @param _vaultManager Underlying `VaultManager` used to borrow stablecoin
    /// @param _lowerCF Lower Collateral Factor accepted without rebalancing
    /// @param _targetCF Target Collateral Factor
    /// @param _upperCF Upper Collateral Factor accepted without rebalancing
    function _initialize(
        string memory _name,
        string memory _symbol,
        IVaultManager _vaultManager,
        uint64 _lowerCF,
        uint64 _targetCF,
        uint64 _upperCF
    ) internal initializer {
        __ERC20_init(_name, _symbol);
        vaultManager = _vaultManager;
        stablecoin = _vaultManager.stablecoin();
        IERC20 _asset = _vaultManager.collateral();
        treasury = _vaultManager.treasury();
        oracle = _vaultManager.oracle();
        vaultManagerDust = _vaultManager.dust();
        asset = _asset;
        _assetBase = 10**(IERC20Metadata(address(_asset)).decimals());
        lastTime = block.timestamp;

        vaultID = _vaultManager.createVault(address(this));

        require(
            0 < _lowerCF &&
                _lowerCF <= _targetCF &&
                _targetCF <= _upperCF &&
                _upperCF <= _vaultManager.collateralFactor(),
            "15"
        );
        lowerCF = _lowerCF;
        targetCF = _targetCF;
        upperCF = _upperCF;

        asset.approve(address(vaultManager), type(uint256).max);
    }

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

    // ========================= External Access Functions =========================

    /// @inheritdoc IERC4626
    function deposit(uint256 assets, address to) public nonReentrant returns (uint256 shares) {
        (uint256 usedAssets, uint256 looseAssets) = _getAssets();
        shares = _convertToShares(assets, usedAssets + looseAssets);
        require(shares != 0, "ZERO_SHARES");
        _deposit(assets, shares, to, usedAssets, looseAssets + assets);
    }

    /// @inheritdoc IERC4626
    function mint(uint256 shares, address to) public nonReentrant returns (uint256 assets) {
        (uint256 usedAssets, uint256 looseAssets) = _getAssets();
        assets = _convertToAssets(shares, usedAssets + looseAssets);
        _deposit(assets, shares, to, usedAssets, looseAssets + assets);
    }

    /// @inheritdoc IERC4626
    /// @dev The amount of assets specified should be smaller than the amount of assets controlled by the
    /// reactor
    function withdraw(
        uint256 assets,
        address to,
        address from
    ) public nonReentrant returns (uint256 shares) {
        (uint256 usedAssets, uint256 looseAssets) = _getAssets();
        shares = _convertToShares(assets, usedAssets + looseAssets);
        _withdraw(assets, shares, to, from, usedAssets, looseAssets);
    }

    /// @notice Rebalances the underlying vault
    function rebalance(
        uint256 toWithdraw,
        uint256 usedAssets,
        uint256 looseAssets
    ) external nonReentrant {
        (uint256 usedAssets, uint256 looseAssets) = _getAssets();
        _rebalance(0, usedAssets, looseAssets);
    }

    /// @inheritdoc IERC4626
    function redeem(
        uint256 shares,
        address to,
        address from
    ) public nonReentrant returns (uint256 assets) {
        (uint256 usedAssets, uint256 looseAssets) = _getAssets();
        require((assets = _convertToAssets(shares, usedAssets + looseAssets)) != 0, "ZERO_ASSETS");
        _withdraw(assets, shares, to, from, usedAssets, looseAssets);
    }

    /// @notice Claims earned rewards
    /// @param from Address to claim for
    /// @return Amount claimed
    function claim(address from) public nonReentrant returns (uint256) {
        _updateAccumulator(from);
        return _claim(from);
    }

    // ============================= View Functions ================================

    /// @inheritdoc IERC4626
    function totalAssets() public view returns (uint256 assets) {
        (uint256 usedAssets, uint256 looseAssets) = _getAssets();
        assets = usedAssets + looseAssets;
    }

    /// @inheritdoc IERC4626
    function convertToShares(uint256 assets) public view returns (uint256) {
        return _convertToShares(assets, totalAssets());
    }

    /// @inheritdoc IERC4626
    function convertToAssets(uint256 shares) public view returns (uint256) {
        return _convertToAssets(shares, totalAssets());
    }

    /// @inheritdoc IERC4626
    function previewDeposit(uint256 assets) public view returns (uint256) {
        return convertToShares(assets);
    }

    /// @inheritdoc IERC4626
    function previewMint(uint256 shares) public view returns (uint256) {
        return convertToAssets(shares);
    }

    /// @notice Computes how many shares one would need to withdraw assets
    /// @param assets Amount of asset to withdraw
    /// @inheritdoc IERC4626
    function previewWithdraw(uint256 assets) public view returns (uint256) {
        return convertToShares(assets);
    }

    /// @notice Computes how many assets one would get by burning shares
    /// @param shares Amount of shares to burn
    /// @inheritdoc IERC4626
    function previewRedeem(uint256 shares) public view returns (uint256) {
        return convertToAssets(shares);
    }

    /// @inheritdoc IERC4626
    /// @dev Technically, the maximum deposit could be less than the max uint256
    /// if there is a `debtCeiling` in the associated `vaultManager`. This implementation
    /// assumes that the `vaultManager` does not have any debt ceiling
    function maxDeposit(address) public pure returns (uint256) {
        return type(uint256).max;
    }

    /// @inheritdoc IERC4626
    function maxMint(address) public pure returns (uint256) {
        return type(uint256).max;
    }

    /// @inheritdoc IERC4626
    // TODO worth completing with restrictions based on current harvest
    function maxWithdraw(address user) public view virtual returns (uint256) {
        return convertToShares(balanceOf(user));
    }

    /// @inheritdoc IERC4626
    // TODO worth completing with restrictions based on current harvest
    function maxRedeem(address user) public view virtual returns (uint256) {
        return balanceOf(user);
    }

    /// @inheritdoc IERC721ReceiverUpgradeable
    function onERC721Received(
        address,
        address,
        uint256,
        bytes memory
    ) external view returns (bytes4) {
        require(msg.sender == address(vaultManager), "3");
        return this.onERC721Received.selector;
    }

    // =========================== Internal Functions ==============================

    /// @notice Gets the assets controlled by the reactor: those in the associated vaultManager
    /// as well as those in the contract
    /// @return usedAssets Amount of the `asset` in the associated `vaultManager`
    /// @return looseAssets Amount of the `asset` in the contract
    function _getAssets() internal view returns (uint256 usedAssets, uint256 looseAssets) {
        (usedAssets, ) = vaultManager.vaultData(vaultID);
        looseAssets = asset.balanceOf(address(this));
    }

    /// @notice Converts an amount of assets to shares of the reactor from an amount of assets controlled by the vault
    /// @param assets Amount of assets to convert
    /// @param totalAssetAmount Total amount of asset controlled by the vault
    /// @return Corresponding amount of shares
    function _convertToShares(uint256 assets, uint256 totalAssetAmount) internal view returns (uint256) {
        uint256 supply = totalSupply();
        return supply == 0 ? assets : (assets * supply) / totalAssetAmount;
    }

    /// @notice Converts an amount of shares of the reactor to assets
    /// @param shares Amount of shares to convert
    /// @param totalAssetAmount Total amount of asset controlled by the vault
    /// @return Corresponding amount of assets
    /// @dev It is at the level of this function that losses from liquidations are taken into account, because this
    /// reduces the totalAssetAmount and hence the amount of assets you are entitled to get from your shares
    function _convertToAssets(uint256 shares, uint256 totalAssetAmount) internal view returns (uint256) {
        uint256 supply = totalSupply();
        return supply == 0 ? shares : (shares * totalAssetAmount) / supply;
    }

    /// @notice Handles the new value of the debt: propagates a loss to the claimable rewards
    /// or a gain depending on the evolution of this debt
    /// @param currentDebt Current value of the debt
    /// @notice In the case where you get liquidated, you actually record a gain in stablecoin,
    /// which is normal to compensate for the decrease of the collateral in the vault
    /// @dev In case where a loss (like from interest taken by the `vaultManager`) is planned, then stakeholders
    /// are incentivized to front run it and claim their rewards in advance. In normal times, this reactor therefore
    /// works well mostly with `vaultManager` on which there are no interest taken (and no borrowing fees)
    function _handleCurrentDebt(uint256 currentDebt) internal {
        if (lastDebt >= currentDebt) {
            // This happens if you have been liquidated or if debt has been paid on your behalf
            _handleGain(lastDebt - currentDebt);
        } else {
            uint256 loss = currentDebt - lastDebt;
            if (claimableRewards >= loss) {
                claimableRewards -= loss;
            } else {
                currentLoss += loss - claimableRewards;
                claimableRewards = 0;
            }
        }
    }

    /// @notice Propagates a gain to the claimable rewards
    /// @param gain Gain to propagate
    function _handleGain(uint256 gain) internal {
        uint256 currentLossVariable = currentLoss;
        if (currentLossVariable >= gain) {
            currentLoss -= gain;
        } else {
            claimableRewards += gain - currentLossVariable;
            currentLoss = 0;
        }
    }

    /// @notice Rebalances the underlying vault
    /// @param toWithdraw Amount of assets to withdraw
    /// @param usedAssets Amount of assets in the vault
    /// @param looseAssets Amount of assets already in the contract
    /// @dev `toWithdraw` is always lower than managed assets (`= usedAssets+looseAssets`): indeed if it was superior
    /// it would mean either
    /// - that the `withdraw` function was called with an amount of assets greater than the amount of asset controlled
    /// by the reactor
    /// - or that the `redeem` function was called with an amount of shares greater than the total supply
    /// @dev `usedAssets` and `looseAssets` are passed as parameters here to avoid performing the same calculation twice
    function _rebalance(
        uint256 toWithdraw,
        uint256 usedAssets,
        uint256 looseAssets
    ) internal {
        uint256 debt = vaultManager.getVaultDebt(vaultID);
        _handleCurrentDebt(debt);
        lastDebt = debt;

        uint256 collateralFactor;
        uint256 toRepay;
        uint256 toBorrow;

        // We're first using as an intermediate in this variable something that does not correspond
        // to the future amount of stablecoins borrowed in the vault: it is the future collateral amount in
        // the vault expressed in stablecoin value and in a custom base
        uint256 futureStablecoinsInVault = (usedAssets + looseAssets - toWithdraw) * oracle.read();
        // The function will revert above if `toWithdraw` is too big

        if (futureStablecoinsInVault == 0) collateralFactor = type(uint256).max;
        else {
            collateralFactor = (BASE_PARAMS * _assetBase * debt) / futureStablecoinsInVault;
        }
        // This is the targeted debt at the end of the call, which might not be reached if the collateral
        // factor is not moved enough
        futureStablecoinsInVault = (futureStablecoinsInVault * targetCF) / (_assetBase * BASE_PARAMS);
        uint16 len = 1;
        (collateralFactor >= upperCF) ? len += 1 : 0; // Needs to repay
        (collateralFactor <= lowerCF && futureStablecoinsInVault > vaultManagerDust) ? len += 1 : 0; // Needs to borrow

        ActionType[] memory actions = new ActionType[](len);
        bytes[] memory datas = new bytes[](len);

        len = 0;

        if (toWithdraw <= looseAssets) {
            // Add Collateral
            actions[len] = ActionType.addCollateral;
            datas[len] = abi.encodePacked(vaultID, looseAssets - toWithdraw);
            len += 1;
        }

        // Dust is also handled here to avoid reverting calls: if repaying the debt would leave a dusty
        // amount then all the debt is repaid
        // If borrowing would only create a dusty debt amount, then nothing happens
        if (collateralFactor >= upperCF) {
            // If the `collateralFactor` is too high, then too much has been borrowed
            // and stablecoins should be repaid
            actions[len] = ActionType.repayDebt;
            toRepay = debt - futureStablecoinsInVault;
            lastDebt -= toRepay;
            if (futureStablecoinsInVault <= vaultManagerDust) {
                // If this happens in a moment at which the reactor has a loss, then it will not be able
                // to repay it all, and the function will revert
                toRepay = type(uint256).max;
                lastDebt = 0;
            }
            datas[len] = abi.encodePacked(vaultID, toRepay);
            len += 1;
        } else if (collateralFactor <= lowerCF && futureStablecoinsInVault > vaultManagerDust) {
            // If the `collateralFactor` is too low, then stablecoins can be borrowed and later
            // invested in strategies
            toBorrow = futureStablecoinsInVault - debt;
            actions[len] = ActionType.borrow;
            datas[len] = abi.encodePacked(vaultID, toBorrow);
            lastDebt += toBorrow;
            len += 1;
        }

        if (toWithdraw > looseAssets) {
            // Removes Collateral
            actions[len] = ActionType.removeCollateral;
            datas[len] = abi.encodePacked(vaultID, toWithdraw - looseAssets);
        }

        if (toRepay > 0) _pull(toRepay);
        vaultManager.angle(actions, datas, address(this), address(this), address(this), "");
        if (toBorrow > 0) _push(toBorrow);
    }

    /// @notice Virtual function to invest stablecoins
    /// @param amount Amount of new stablecoins managed
    /// @return amountInvested Amount invested in the strategy
    /// @dev Calling this function should eventually trigger something regarding strategies depending
    /// on a threshold
    function _push(uint256 amount) internal virtual returns (uint256 amountInvested) {}

    /// @notice Virtual function to withdraw stablecoins
    /// @param amount Amount needed at the end of the call
    /// @return amountAvailable Amount available in the contracts, it's like a new `looseAssets` value
    /// @dev Eventually actually triggers smthg depending on a threshold
    /// @dev Calling this function should eventually trigger something regarding strategies depending
    /// on a threshold
    function _pull(uint256 amount) internal virtual returns (uint256 amountAvailable) {}

    /// @notice Claims rewards earned by a user
    /// @param from Address to claim rewards from
    /// @return amount Amount claimed by the user
    /// @dev Function will revert if there has been no mint
    function _claim(address from) internal returns (uint256 amount) {
        amount = (claimableRewards * rewardsAccumulatorOf[from]) / (rewardsAccumulator - claimedRewardsAccumulator);

        claimedRewardsAccumulator += rewardsAccumulatorOf[from];
        rewardsAccumulatorOf[from] = 0;
        lastTimeOf[from] = block.timestamp;

        claimableRewards -= amount;

        amount = _pull(amount);
        stablecoin.transfer(from, amount);
    }

    /// @notice Updates global and `msg.sender` accumulator and rewards share
    /// @param from Address balance changed
    function _updateAccumulator(address from) internal {
        rewardsAccumulator += (block.timestamp - lastTime) * totalSupply();
        lastTime = block.timestamp;

        rewardsAccumulatorOf[from] += (block.timestamp - lastTimeOf[from]) * balanceOf(from);
        lastTimeOf[from] = block.timestamp;
    }

    /// @notice Internal function for `deposit` and `mint`
    /// @dev This function takes `usedAssets` and `looseAssets` as parameters to avoid repeated external calls
    function _deposit(
        uint256 assets,
        uint256 shares,
        address to,
        uint256 usedAssets,
        uint256 looseAssets
    ) internal {
        // Need to transfer before minting or ERC777s could reenter.
        asset.safeTransferFrom(msg.sender, address(this), assets);
        _updateAccumulator(to);
        _mint(to, shares);

        emit Deposit(msg.sender, to, assets, shares);

        _rebalance(0, usedAssets, looseAssets);
    }

    /// @notice Internal function for `redeem` and `withdraw`
    /// @dev This function takes `usedAssets` and `looseAssets` as parameters to avoid repeated external calls
    function _withdraw(
        uint256 assets,
        uint256 shares,
        address to,
        address from,
        uint256 usedAssets,
        uint256 looseAssets
    ) internal {
        if (msg.sender != from) {
            uint256 currentAllowance = allowance(from, msg.sender);
            require(currentAllowance >= shares, "ERC20: transfer amount exceeds allowance");
            if (currentAllowance != type(uint256).max) {
                unchecked {
                    _approve(from, msg.sender, currentAllowance - shares);
                }
            }
        }

        _updateAccumulator(from);
        _rebalance(assets, usedAssets, looseAssets);

        _claim(from);

        _burn(from, shares);

        emit Withdraw(from, to, assets, shares);
        asset.safeTransfer(to, assets);
    }

    // ======================== Governance Functions ===============================

    /// @notice Changes the reference to the `oracle` contract
    /// @dev This is a permissionless function anyone can call to make sure that the oracle
    /// contract of the `VaultManager` is the same as the oracle contract of this contract
    function setOracle() external {
        oracle = vaultManager.oracle();
    }

    /// @notice Changes the treasury contract
    /// @dev Like the function above, this permissionless function just adjusts the treasury to
    /// the address of the treasury contract from the `vaultManager` in case it has been modified
    function setTreasury() external {
        treasury = vaultManager.treasury();
    }

    /// @notice Changes the dust parameter by querying the `vaultManager`
    function setDust() external {
        vaultManagerDust = vaultManager.dust();
    }

    /// @notice Sets parameters encoded as uint64
    /// @param param Value for the parameter
    /// @param what Parameter to change
    /// @dev This function performs the required checks when updating a parameter
    function setUint64(uint64 param, bytes32 what) external onlyGovernorOrGuardian {
        if (what == "lowerCF") {
            require(0 < param && param <= targetCF, "18");
            lowerCF = param;
        } else if (what == "targetCF") {
            require(lowerCF <= param && param <= upperCF, "18");
            targetCF = param;
        } else if (what == "upperCF") {
            require(targetCF <= param && param <= vaultManager.collateralFactor(), "18");
            upperCF = param;
        } else {
            revert("43");
        }
        emit FiledUint64(param, what);
    }

    /// @notice Allows to recover any ERC20 token, including the asset managed by the reactor
    /// @param tokenAddress Address of the token to recover
    /// @param to Address of the contract to send collateral to
    /// @param amountToRecover Amount of collateral to transfer
    /// @dev Can be used to handle partial liquidation and debt repayment in case it is needed: in this
    /// case governance can withdraw assets, swap in stablecoins to repay debt
    function recoverERC20(
        address tokenAddress,
        address to,
        uint256 amountToRecover
    ) external onlyGovernor {
        require(tokenAddress != address(stablecoin), "51");
        IERC20(tokenAddress).safeTransfer(to, amountToRecover);
        emit Recovered(tokenAddress, to, amountToRecover);
    }
}

contract Reactor is BaseReactor {
    function initialize(
        string memory _name,
        string memory _symbol,
        IVaultManager _vaultManager,
        uint64 _lowerCF,
        uint64 _targetCF,
        uint64 _upperCF
    ) external {
        _initialize(_name, _symbol, _vaultManager, _lowerCF, _targetCF, _upperCF);
    }
}
