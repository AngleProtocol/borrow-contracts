// SPDX-License-Identifier: AGPL-3.0-only

pragma solidity 0.8.12;

import "hardhat/console.sol";
import "./BaseReactorStorage.sol";

// TODO what happens if my vault gets liquidated in the `VaultManager`

/// @notice Reactor for using a token as collateral for agTokens. ERC4646 tokenized Vault implementation.
/// @author Angle Core Team, based on Solmate (https://github.com/Rari-Capital/solmate/blob/main/src/mixins/ERC4626.sol)
/// @dev WARNING - Built with an "internal" `VaultManager`
/// @dev WARNING - Built on the assumption that the underlying VaultManager does not take fees
/// @dev A token used as an asset built to exploit this reactor could perform reentrancy attacks if not enough checks
/// are performed: as such the protocol
contract BaseReactor is BaseReactorStorage, ERC20Upgradeable, IERC4626 {
    using SafeERC20 for IERC20;

    /// @notice Initializes the `BaseReactor` contract and
    /// the underlying `VaultManager`
    /// @param _name Name of the ERC4626 token
    /// @param _symbol Symbol of the ERC4626 token
    /// @param _asset Asset used as collateral by this reactor
    /// @param _vaultManager Underlying `VaultManager` used to borrow stablecoin
    /// @param _treasury Reference to the `treasury` contract
    /// @param _oracle Oracle contract used
    /// @param _lowerCF Lower Collateral Factor accepted without rebalancing
    /// @param _targetCF Target Collateral Factor
    /// @param _upperCF Upper Collateral Factor accepted without rebalancing
    function initialize(
        string memory _name,
        string memory _symbol,
        IERC20 _asset,
        IVaultManager _vaultManager,
        ITreasury _treasury,
        IOracle _oracle,
        uint64 _lowerCF,
        uint64 _targetCF,
        uint64 _upperCF,
        VaultParameters calldata params
    ) external initializer {
        __ERC20_init(_name, _symbol);

        asset = _asset;
        _assetBase = IERC20Metadata(address(_asset)).decimals();
        vaultManager = _vaultManager;
        stablecoin = IAgToken(_treasury.stablecoin());
        treasury = _treasury;
        oracle = _oracle;
        lastTime = block.timestamp;

        vaultManager.initialize(treasury, asset, IOracle(address(this)), params);
        vaultID = _vaultManager.createVault(address(this));

        require(0 < _lowerCF && _lowerCF <= _targetCF && _targetCF <= _upperCF && _upperCF <= params.collateralFactor);
        lowerCF = _lowerCF;
        targetCF = _targetCF;
        upperCF = _upperCF;

        asset.approve(address(vaultManager), type(uint256).max);
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {}

    // ============================== Modifiers ====================================

    /// @notice Checks whether the `msg.sender` has the governor role or not
    modifier onlyGovernor() {
        require(treasury.isGovernor(msg.sender));
        _;
    }

    /// @notice Checks whether the `msg.sender` has the governor role or the guardian role
    modifier onlyGovernorOrGuardian() {
        require(treasury.isGovernorOrGuardian(msg.sender));
        _;
    }

    /// @notice Reads the oracle and store it in cache during the function call
    modifier needOracle() {
        _oracleRate = oracle.read();
        _oracleRateCached = true;
        _;
        _oracleRate = 0;
        _oracleRateCached = false;
    }

    // ========================= External Access Functions =========================

    /// @notice Transfers a given amount of asset to the reactor and mint shares accordingly
    /// @param assets Given amount of asset
    /// @param to Address to mint shares to
    function deposit(uint256 assets, address to) public nonReentrant returns (uint256 shares) {
        // Check for rounding error since we round down in convertToShares.
        shares = convertToShares(assets);
        require(shares != 0, "ZERO_SHARES");

        // Need to transfer before minting or ERC777s could reenter.
        asset.safeTransferFrom(msg.sender, address(this), assets);
        _deposit(assets, shares, to);
    }

    /// @notice Mints a given amount of shares to the reactor and transfer assets accordingly
    /// @param shares Given amount of shares
    /// @param to Address to mint shares to
    function mint(uint256 shares, address to) public nonReentrant returns (uint256 assets) {
        assets = previewMint(shares); // No need to check for rounding error, previewMint rounds up.

        // Need to transfer before minting or ERC777s could reenter.
        asset.safeTransferFrom(msg.sender, address(this), assets);
        _deposit(assets, shares, to);
    }

    /// @notice Transfers a given amount of asset from the reactor and burn shares accordingly
    /// @param assets Given amount of asset
    /// @param from Address to burn shares from
    /// @param to Address to transfer assets to
    function withdraw(
        uint256 assets,
        address to,
        address from
    ) public nonReentrant returns (uint256 shares) {
        shares = previewWithdraw(assets); // No need to check for rounding error, previewWithdraw rounds up.
        _withdraw(assets, shares, to, from);
        asset.safeTransfer(to, assets);
    }

    /// @notice Burns a given amount of shares to the reactor and transfer assets accordingly
    /// @param shares Given amount of shares
    /// @param from Address to burn shares from
    /// @param to Address to transfer assets to
    function redeem(
        uint256 shares,
        address to,
        address from
    ) public nonReentrant returns (uint256 assets) {
        // Check for rounding error since we round down in convertToAssets.
        require((assets = convertToAssets(shares)) != 0, "ZERO_ASSETS");
        _withdraw(assets, shares, to, from);
        asset.safeTransfer(to, assets);
    }

    /// @notice Claims earned rewards
    /// @param from Address to claim for
    function claim(address from) public nonReentrant returns (uint256 amount) {
        _updateAccumulator(from);
        amount = _claim(from);
    }

    // ============================= View Functions ================================

    /// @notice Returns the total assets managed by this reactor
    function totalAssets() public view returns (uint256 assets) {
        (assets, ) = vaultManager.vaultData(vaultID);
        assets = asset.balanceOf(address(this)) + assets;
    }

    /// @notice Converts an amount of assets to the corresponding amount of reactor shares
    /// @param assets Amount of asset to convert
    function convertToShares(uint256 assets) public view returns (uint256) {
        uint256 supply = totalSupply(); // Saves an extra SLOAD if totalSupply is non-zero.

        return supply == 0 ? assets : (assets * supply) / totalAssets();
    }

    /// @notice Converts an amount of shares to its current value in asset
    /// @param shares Amount of shares to convert
    function convertToAssets(uint256 shares) public view returns (uint256) {
        uint256 supply = totalSupply(); // Saves an extra SLOAD if totalSupply is non-zero.

        return supply == 0 ? shares : (shares * totalAssets()) / supply;
    }

    /// @notice Computes how many shares one would get by depositing
    /// @param assets Amount of asset to convert
    function previewDeposit(uint256 assets) public view returns (uint256) {
        return convertToShares(assets);
    }

    /// @notice Computes how many assets one would need to mint
    /// @param shares Amount of shares required
    function previewMint(uint256 shares) public view returns (uint256) {
        return convertToAssets(shares);
    }

    /// @notice Computes how many shares one would need to withdraw
    /// @param assets Amount of asset to withdraw
    function previewWithdraw(uint256 assets) public view returns (uint256) {
        return convertToShares(assets);
    }

    /// @notice Computes how many assets one would need by burning shares
    /// @param shares Amount of shares to burn
    function previewRedeem(uint256 shares) public view returns (uint256) {
        return convertToAssets(shares);
    }

    /// @notice Max deposit allowed
    function maxDeposit(address) public pure returns (uint256) {
        return type(uint256).max;
    }

    /// @notice Max mint allowed
    function maxMint(address) public pure returns (uint256) {
        return type(uint256).max;
    }

    // TODO worth completing with restrictions based on current harvest
    function maxWithdraw(address user) public view virtual returns (uint256) {
        return convertToShares(balanceOf(user));
    }

    // TODO worth completing with restrictions based on current harvest
    function maxRedeem(address user) public view virtual returns (uint256) {
        return balanceOf(user);
    }

    /// @notice Enables management of vaults by the reactor
    function onERC721Received(
        address,
        address,
        uint256,
        bytes memory
    ) external view returns (bytes4) {
        require(msg.sender == address(vaultManager));
        return this.onERC721Received.selector;
    }

    // =========================== Internal Functions ==============================

    /// @notice Handles the new value of the debt: propagates a loss to the claimable rewards
    /// or a gain depending on the evolution of this debt
    /// @param currentDebt Current value of the debt
    // TODO: set up does not work well if you get liquidated: your debt decreases but so does your collateral value
    // as well, and you don't want to record that as a gain -> so you need to find another alternative for this
    function _handleCurrentDebt(uint256 currentDebt) internal {
        if (lastDebt >= currentDebt) {
            // TODO this is for the case where debt has been paid on your behalf
            _handleGain(lastDebt - currentDebt);
        } else {
            uint256 loss = currentDebt - lastDebt;
            if (claimableRewards >= loss) {
                claimableRewards -= loss;
            } else {
                currentLoss = loss - claimableRewards;
                claimableRewards = 0;
            }
        }
    }

    /// @notice Propagates a gain to the claimable rewards
    /// @param gain Gain to propagate
    function _handleGain(uint256 gain) internal {
        if (currentLoss >= gain) {
            currentLoss -= gain;
        } else {
            claimableRewards += gain - currentLoss;
            currentLoss = 0;
        }
    }

    /// @notice Rebalances the underlying vault
    /// @param toWithdraw Amount of assets to withdraw
    /// @dev `toWithdraw` needs to be always lower than managed assets
    function _rebalance(uint256 toWithdraw) internal needOracle {
        uint256 debt = vaultManager.getVaultDebt(vaultID);
        _handleCurrentDebt(debt);
        lastDebt = debt;

        uint256 looseAssets = asset.balanceOf(address(this));
        uint256 usedAssets;
        uint256 collateralFactor;
        uint256 toRepay;
        uint256 toBorrow;

        if (debt > 0) {
            (usedAssets, ) = vaultManager.vaultData(vaultID);
        }

        if (usedAssets + looseAssets > toWithdraw) {
            // This is what the collateral factor is going to look like at the end of the call
            collateralFactor =
                (BASE_PARAMS * _assetBase * debt) /
                ((usedAssets + looseAssets - toWithdraw) * _oracleRate);
        } else {
            collateralFactor = type(uint256).max;
            toRepay = debt;
        }

        uint16 len = 1;
        (collateralFactor >= upperCF) ? len += 1 : 0; // Needs to repay
        (collateralFactor <= lowerCF) ? len += 1 : 0; // Needs to borrow

        ActionType[] memory actions = new ActionType[](len);
        bytes[] memory datas = new bytes[](len);

        len = 0;

        if (toWithdraw <= looseAssets) {
            // Add Collateral
            actions[len] = ActionType.addCollateral;
            datas[len] = abi.encodePacked(vaultID, looseAssets - toWithdraw);
            len += 1;
        }

        // Dust is fully handled by the `VaultManager`: any action that will lead to a dusty amount
        // in the vault will revert
        if (collateralFactor >= upperCF) {
            // If the `collateralFactor` is too high, then too much has been borrowed
            // and stablecoins should be repaid
            actions[len] = ActionType.repayDebt;
            if (usedAssets + looseAssets > toWithdraw) {
                toRepay =
                    debt -
                    (((usedAssets + looseAssets - toWithdraw) * _oracleRate) * targetCF) /
                    (_assetBase * BASE_PARAMS);
            }
            // In the other case, we have `toRepay > debt`
            datas[len] = abi.encodePacked(vaultID, toRepay);
            lastDebt -= toRepay;
            len += 1;
        } else if (collateralFactor <= lowerCF) {
            // If the `collateralFactor` is too low, then stablecoins can be borrowed and later
            // invested in strategies
            actions[len] = ActionType.borrow;
            toBorrow =
                (((usedAssets + looseAssets - toWithdraw) * _oracleRate) * targetCF) /
                (_assetBase * BASE_PARAMS) -
                debt;
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
    /// @dev Eventually actually triggers smthg depending on a threshold
    function _push(uint256 amount) internal virtual returns (uint256 amountInvested) {}

    /// @notice Virtual function to withdraw stablecoins
    /// @param amount Amount needed at the end of the call
    /// @dev Eventually actually triggers smthg depending on a threshold
    /// @dev Must make sure that amount is available
    function _pull(uint256 amount) internal virtual returns (uint256 amountAvailable) {}

    /// @notice Claims rewards earned by a user
    /// @param from Address to claim rewards from
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
    function _deposit(
        uint256 assets,
        uint256 shares,
        address to
    ) internal {
        _updateAccumulator(to);
        _mint(to, shares);

        emit Deposit(msg.sender, to, assets, shares);

        _rebalance(0);
    }

    /// @notice Internal function for `redeem` and `withdraw`
    function _withdraw(
        uint256 assets,
        uint256 shares,
        address to,
        address from
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
        _rebalance(assets);

        _claim(from);

        _burn(from, shares);

        emit Withdraw(from, to, assets, shares);
    }

    // =============================== IOracle =====================================

    /// @notice Reads the rate from the oracle or cached if possible
    function read() external view returns (uint256 rate) {
        if (_oracleRateCached) return _oracleRate;
        return oracle.read();
    }

    // ======================== Governance Functions ===============================

    /// @notice Changes the treasury contract
    /// @param _treasury Address of the new treasury contract
    /// @dev To propagate the changes to the oracle, governance should make sure
    /// to call the oracle contract as well
    function setTreasury(address _treasury) external {
        require(treasury.isVaultManager(msg.sender), "3");
        treasury = ITreasury(_treasury);
    }

    /// @notice Sets parameters encoded as uint64
    /// @param param Value for the parameter
    /// @param what Parameter to change
    /// @dev This function performs the required checks when updating a parameter
    function setUint64(uint64 param, bytes32 what) external onlyGovernorOrGuardian {
        if (what == "lowerCF") {
            require(0 < param && param <= targetCF);
            lowerCF = param;
        } else if (what == "targetCF") {
            require(lowerCF <= param && param <= upperCF);
            targetCF = param;
        } else if (what == "upperCF") {
            require(targetCF <= param && param <= vaultManager.collateralFactor());
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
    /// @dev Can be used to handle partial liquidation and debt repayment in case it is needed
    function recoverERC20(
        address tokenAddress,
        address to,
        uint256 amountToRecover
    ) external onlyGovernor {
        IERC20(tokenAddress).safeTransfer(to, amountToRecover);
        emit Recovered(tokenAddress, to, amountToRecover);
    }
}
