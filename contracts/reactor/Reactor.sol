// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity >=0.8.0;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import "../interfaces/IERC4626.sol";
import "../interfaces/ITreasury.sol";
import { IVaultManagerExtended as IVaultManager, ActionType } from "../interfaces/IVaultManager.sol";
import "../interfaces/IStrategy.sol";

struct StrategyParameters {
    uint256 lastReport;
    uint256 totalStrategyDebt;
    uint256 debtRatio;
}

/// @notice Reactor for using a token as collateral for agTokens. ERC4646 tokenized Vault implementation.
/// @author Angle Core Team, partly Forked from Solmate (https://github.com/Rari-Capital/solmate/blob/main/src/mixins/ERC4626.sol)
/// @dev Do not use in production! ERC-4626 is still in the review stage and is subject to change.
/// @dev WARNING - Built only for 18 decimals token
/// @dev WARNING - Built on the assumption that the underlying VaultManager does not take fees
contract Reactor is IERC4626, ERC20 {
    using SafeERC20 for IERC20;

    event StrategyAdded(address indexed strategy, uint256 debtRatio);
    event StrategyRevoked(address indexed strategy);
    event StrategyReported(
        address indexed strategy,
        uint256 gain,
        uint256 loss,
        uint256 debtPayment,
        uint256 totalDebt
    );

    /*///////////////////////////////////////////////////////////////
                               CONSTANTS AND IMMUTABLES
    //////////////////////////////////////////////////////////////*/

    uint256 public constant BASE_PARAMS = 10**9;

    IERC20 public immutable asset;
    IERC20 public immutable stable;
    ITreasury public immutable treasury;
    IVaultManager public immutable vaultManager;
    uint256 public immutable vaultID;
    uint256 public immutable startTime;

    /*///////////////////////////////////////////////////////////////
                               VARIABLES
    //////////////////////////////////////////////////////////////*/
    uint256 public claimableRewards;
    uint256 public currentLoss;

    uint256 public rewardsAccumulator;
    uint256 public claimedRewardsAccumulator;
    uint256 public lastTime;
    mapping(address => uint256) public lastTimeOf;
    mapping(address => uint256) public lastShareOf;
    mapping(address => uint256) public rewardsAccumulatorOf;

    uint64 public lowerCollateralFactor;
    uint64 public targetCollateralFactor;
    uint64 public upperCollateralFactor;

    /// @notice Last known stable debt to the vaultManager
    uint256 public lastDebt;

    /// @notice Funds currently given to strategies
    uint256 public totalDebt;

    /// @notice Proportion of the funds managed dedicated to strategies
    /// Has to be between 0 and `BASE_PARAMS`
    uint256 public debtRatio;

    /// @notice List of the current strategies
    address[] public strategyList;

    /// @notice Mapping between the address of a strategy contract and its corresponding details
    mapping(address => StrategyParameters) public strategies;

    constructor(
        ERC20 _asset,
        string memory _name,
        string memory _symbol,
        ERC20 _stable,
        IVaultManager _vaultManager,
        ITreasury _treasury
    ) ERC20(_name, _symbol) {
        asset = _asset;
        stable = _stable;
        vaultManager = _vaultManager;
        vaultID = _vaultManager.createVault(address(this));
        treasury = _treasury;
        startTime = block.timestamp;
        lastTime = block.timestamp;
    }

    /*///////////////////////////////////////////////////////////////
                               MODIFIERS
    //////////////////////////////////////////////////////////////*/

    modifier onlyGovernorOrGuardian() {
        require(treasury.isGovernorOrGuardian(msg.sender));
        _;
    }

    modifier onlyGovernor() {
        require(treasury.isGovernor(msg.sender));
        _;
    }

    modifier onlyStrategy() {
        require(strategies[msg.sender].lastReport > 0);
        _;
    }

    /// @notice Checks if the new address given is not null
    /// @param newAddress Address to check
    modifier zeroCheck(address newAddress) {
        require(newAddress != address(0), "0");
        _;
    }

    modifier updateAccumulator(address from) {
        rewardsAccumulator += (block.timestamp - lastTime) * totalSupply();
        lastTime = block.timestamp;

        rewardsAccumulatorOf[from] += (block.timestamp - lastTimeOf[from]) * balanceOf(from);
        lastTimeOf[from] = block.timestamp;

        _;
    }

    /*///////////////////////////////////////////////////////////////
                        DEPOSIT/WITHDRAWAL LOGIC
    //////////////////////////////////////////////////////////////*/

    function deposit(uint256 amount, address to) public updateAccumulator(msg.sender) returns (uint256 shares) {
        // Check for rounding error since we round down in previewDeposit.
        shares = previewDeposit(amount);
        require(shares != 0, "ZERO_SHARES");

        // Need to transfer before minting or ERC777s could reenter.
        asset.safeTransferFrom(msg.sender, address(this), amount);

        _mint(to, shares);

        emit Deposit(msg.sender, to, amount, shares);

        _afterDeposit(amount);
    }

    function mint(uint256 shares, address to) public updateAccumulator(msg.sender) returns (uint256 amount) {
        amount = previewMint(shares); // No need to check for rounding error, previewMint rounds up.

        // Need to transfer before minting or ERC777s could reenter.
        asset.safeTransferFrom(msg.sender, address(this), amount);

        _mint(to, amount);

        emit Deposit(msg.sender, to, amount, shares);

        _afterDeposit(amount);
    }

    function withdraw(
        uint256 amount,
        address to,
        address from
    ) public updateAccumulator(from) returns (uint256 shares) {
        shares = previewWithdraw(amount); // No need to check for rounding error, previewWithdraw rounds up.

        if (msg.sender != from) {
            uint256 currentAllowance = allowance(to, msg.sender);
            require(currentAllowance >= shares, "ERC20: transfer amount exceeds allowance");
            if (currentAllowance != type(uint256).max) {
                unchecked {
                    _approve(msg.sender, _msgSender(), currentAllowance - shares);
                }
            }
        }

        _beforeWithdraw(amount);

        _burn(from, shares);

        emit Withdraw(from, to, amount, shares);

        asset.safeTransfer(to, amount);
    }

    function redeem(
        uint256 shares,
        address to,
        address from
    ) public updateAccumulator(from) returns (uint256 amount) {
        if (msg.sender != from) {
            uint256 currentAllowance = allowance(to, msg.sender);
            require(currentAllowance >= shares, "ERC20: transfer amount exceeds allowance");
            if (currentAllowance != type(uint256).max) {
                unchecked {
                    _approve(msg.sender, _msgSender(), currentAllowance - shares);
                }
            }
        }
        // Check for rounding error since we round down in previewRedeem.
        require((amount = previewRedeem(shares)) != 0, "ZERO_ASSETS");

        _beforeWithdraw(amount);

        _burn(from, shares);

        emit Withdraw(from, to, amount, shares);

        asset.safeTransfer(to, amount);
    }

    /*///////////////////////////////////////////////////////////////
                           ACCOUNTING LOGIC
    //////////////////////////////////////////////////////////////*/

    function totalAssets() public view returns (uint256 amount) {
        amount = asset.balanceOf(address(this)) + vaultManager.vaultData(vaultID).collateralAmount;
    }

    function assetsOf(address user) public view returns (uint256) {
        return previewRedeem(balanceOf(user));
    }

    function assetsPerShare() public view returns (uint256) {
        return previewRedeem(1 ether); // TODO
    }

    function previewDeposit(uint256 amount) public view returns (uint256) {
        uint256 supply = totalSupply(); // Saves an extra SLOAD if totalSupply is non-zero.

        return supply == 0 ? amount : (amount * supply) / totalAssets();
    }

    function previewMint(uint256 shares) public view returns (uint256) {
        uint256 supply = totalSupply(); // Saves an extra SLOAD if totalSupply is non-zero.

        return supply == 0 ? shares : (shares * totalAssets()) / supply;
    }

    function previewWithdraw(uint256 amount) public view virtual returns (uint256) {
        uint256 supply = totalSupply(); // Saves an extra SLOAD if totalSupply is non-zero.

        return supply == 0 ? amount : (amount * supply) / totalAssets();
    }

    function previewRedeem(uint256 shares) public view virtual returns (uint256) {
        uint256 supply = totalSupply(); // Saves an extra SLOAD if totalSupply is non-zero.

        return supply == 0 ? shares : (shares * totalAssets()) / supply;
    }

    /*///////////////////////////////////////////////////////////////
                     DEPOSIT/WITHDRAWAL LIMIT LOGIC
    //////////////////////////////////////////////////////////////*/

    function maxDeposit(address) public pure returns (uint256) {
        return type(uint256).max;
    }

    function maxMint(address) public pure returns (uint256) {
        return type(uint256).max;
    }

    function maxWithdraw(address user) public view returns (uint256) {
        return assetsOf(user); // TODO worth completing with restrictions based on current harvest
    }

    function maxRedeem(address user) public view returns (uint256) {
        return balanceOf(user); // TODO worth completing with restrictions based on current harvest
    }

    /*///////////////////////////////////////////////////////////////
                     STRATEGY LOGIC
    //////////////////////////////////////////////////////////////*/

    function report(
        uint256 gain,
        uint256 loss,
        uint256 debtPayment
    ) external onlyStrategy {
        require(stable.balanceOf(msg.sender) >= gain + debtPayment);

        StrategyParameters storage params = strategies[msg.sender];
        // Updating parameters in the `perpetualManager`
        // This needs to be done now because it has implications in `_getTotalAsset()`
        params.totalStrategyDebt = params.totalStrategyDebt + gain - loss;
        totalDebt = totalDebt + gain - loss;
        params.lastReport = block.timestamp;

        // Warning: `_getTotalAsset` could be manipulated by flashloan attacks.
        // It may allow external users to transfer funds into strategy or remove funds
        // from the strategy. Yet, as it does not impact the profit or loss and as attackers
        // have no interest in making such txs to have a direct profit, we let it as is.
        // The only issue is if the strategy is compromised; in this case governance
        // should revoke the strategy
        uint256 target = ((stable.balanceOf(address(this)) + totalDebt) * params.debtRatio) / BASE_PARAMS;
        if (target > params.totalStrategyDebt) {
            // If the strategy has some credit left, tokens can be transferred to this strategy
            uint256 available = Math.min(target - params.totalStrategyDebt, stable.balanceOf(address(this)));
            params.totalStrategyDebt = params.totalStrategyDebt + available;
            totalDebt = totalDebt + available;
            if (available > 0) {
                stable.safeTransfer(msg.sender, available);
            }
        } else {
            uint256 available = Math.min(params.totalStrategyDebt - target, debtPayment + gain);
            params.totalStrategyDebt = params.totalStrategyDebt - available;
            totalDebt = totalDebt - available;
            if (available > 0) {
                stable.safeTransferFrom(msg.sender, address(this), available);
            }
        }
        emit StrategyReported(msg.sender, gain, loss, debtPayment, params.totalStrategyDebt);

        // Handle gains before losses
        if (gain > 0) {
            if (currentLoss > 0) {
                if (gain < currentLoss) {
                    currentLoss -= gain;
                } else {
                    currentLoss = 0;
                    claimableRewards += gain - currentLoss;
                }
            } else {
                claimableRewards += gain;
            }
        }

        // Handle eventual losses
        if (loss > 0) {
            _handleLoss(loss);
        }
    }

    /// @notice Withdraws a given amount from a strategy
    /// @param strategy The address of the strategy
    /// @param amount The amount to withdraw
    function withdrawFromStrategy(IStrategy strategy, uint256 amount) external onlyGovernorOrGuardian {
        StrategyParameters storage params = strategies[address(strategy)];
        require(params.lastReport != 0);

        uint256 loss;
        (amount, loss) = strategy.withdraw(amount);

        // Handling eventual losses
        params.totalStrategyDebt = params.totalStrategyDebt - loss - amount;
        totalDebt = totalDebt - loss - amount;

        emit StrategyReported(address(strategy), 0, loss, amount - loss, params.totalStrategyDebt);

        // Handle eventual losses
        // With the strategy we are using in current tests, it is going to be impossible to have
        // a positive loss by calling strategy.withdraw, this function indeed calls _liquidatePosition
        // which output value is always zero
        // if (loss > 0) stableMaster.signalLoss(loss); //TODO
    }

    /// @notice Adds a strategy
    /// @param strategy The address of the strategy to add
    /// @param _debtRatio The share of the total assets that the strategy has access to
    function addStrategy(address strategy, uint256 _debtRatio) external onlyGovernor zeroCheck(strategy) {
        StrategyParameters storage params = strategies[strategy];

        require(params.lastReport == 0);
        require(address(this) == IStrategy(strategy).vault());
        require(address(stable) == IStrategy(strategy).want());
        require(debtRatio + _debtRatio <= BASE_PARAMS);

        // Add strategy to approved strategies
        params.lastReport = 1;
        params.totalStrategyDebt = 0;
        params.debtRatio = _debtRatio;

        // Update global parameters
        debtRatio += _debtRatio;
        emit StrategyAdded(strategy, debtRatio);

        strategyList.push(strategy);
    }

    /// @notice Modifies the funds a strategy has access to
    /// @param strategy The address of the Strategy
    function updateStrategyDebtRatio(address strategy, uint256 _debtRatio) external onlyGovernorOrGuardian {
        _updateStrategyDebtRatio(strategy, _debtRatio);
    }

    /// @notice Triggers an emergency exit for a strategy and then harvests it to fetch all the funds
    /// @param strategy The address of the `Strategy`
    function setStrategyEmergencyExit(address strategy) external onlyGovernorOrGuardian {
        _updateStrategyDebtRatio(strategy, 0);
        IStrategy(strategy).setEmergencyExit();
        IStrategy(strategy).harvest();
    }

    /// @notice Revokes a strategy
    /// @param strategy The address of the strategy to revoke
    /// @dev This should only be called after the following happened in order: the `strategy.debtRatio` has been set to 0,
    /// `harvest` has been called enough times to recover all capital gain/losses.
    function revokeStrategy(address strategy) external onlyGovernorOrGuardian {
        StrategyParameters storage params = strategies[strategy];

        require(params.debtRatio == 0);
        require(params.totalStrategyDebt == 0);
        uint256 strategyListLength = strategyList.length;
        require(params.lastReport != 0 && strategyListLength >= 1);
        // It has already been checked whether the strategy was a valid strategy
        for (uint256 i = 0; i < strategyListLength - 1; i++) {
            if (strategyList[i] == strategy) {
                strategyList[i] = strategyList[strategyListLength - 1];
                break;
            }
        }

        strategyList.pop();

        // Update global parameters
        debtRatio -= params.debtRatio;
        delete strategies[strategy];

        emit StrategyRevoked(strategy);
    }

    function _handleLoss(uint256 loss) internal {
        if (claimableRewards > loss) {
            claimableRewards -= loss;
        } else {
            claimableRewards = 0;
            currentLoss = loss - claimableRewards;
        }
    }

    // @dev `toWithdraw` needs to be always lower than managed assets
    // TODO Shall we pass amount
    function _rebalance(uint256 toWithdraw) internal {
        // TODO How to optimize this call ? I don't think it is doable
        // TODO store oracle or fetch each time
        uint256 oracleValue = vaultManager.oracle().read();
        uint256 debt = vaultManager.getVaultDebt(vaultID);
        _handleLoss(debt - lastDebt); //TODO assert here that > 0 ?
        lastDebt = debt;
        uint256 looseAssets = asset.balanceOf(address(this));
        uint256 usedAssets = vaultManager.vaultData(vaultID).collateralAmount;
        uint256 collateralFactor = ((usedAssets + looseAssets - toWithdraw) * oracleValue) / 1 ether / debt;

        uint16 len = 1;
        (collateralFactor * upperCollateralFactor >= BASE_PARAMS) ? len += 1 : 0;
        (collateralFactor * lowerCollateralFactor <= BASE_PARAMS) ? len += 1 : 0;

        ActionType[] memory actions = new ActionType[](len);
        bytes[] memory datas = new bytes[](len);

        len = 0;

        if (toWithdraw <= looseAssets) {
            // Add Collateral
            actions[len] = ActionType.addCollateral;
            datas[len] = abi.encodePacked(vaultID, looseAssets - toWithdraw);
            len += 1;
        }

        // TODO Dust can occur in the following lines. We need to check if it is on the correct side
        if (collateralFactor * upperCollateralFactor >= BASE_PARAMS) {
            // Repay
            actions[len] = ActionType.repayDebt;
            uint256 toRepay = debt -
                (((usedAssets + looseAssets - toWithdraw) * oracleValue) * targetCollateralFactor) /
                1 ether /
                BASE_PARAMS;

            datas[len] = abi.encodePacked(vaultID, toRepay);
            lastDebt -= toRepay; //TODO reentrancy ?
            len += 1;
        } else if (collateralFactor * lowerCollateralFactor <= BASE_PARAMS) {
            // Borrow
            actions[len] = ActionType.borrow;
            uint256 toBorrow = (((usedAssets + looseAssets - toWithdraw) * oracleValue) * targetCollateralFactor) /
                1 ether /
                BASE_PARAMS -
                debt;
            datas[len] = abi.encodePacked(vaultID, toBorrow);
            lastDebt += toBorrow; //TODO reentrancy ?
            len += 1;
        }

        if (toWithdraw > looseAssets) {
            // Remove Collateral
            actions[len] = ActionType.removeCollateral;
            datas[len] = abi.encodePacked(vaultID, toWithdraw - looseAssets);
        }

        vaultManager.angle(actions, datas, address(this), address(this), address(this), "");
    }

    function _claim(address from, address to) internal {
        uint256 amount = (claimableRewards * rewardsAccumulatorOf[from]) /
            (rewardsAccumulator - claimedRewardsAccumulator);

        claimedRewardsAccumulator += rewardsAccumulatorOf[from];
        rewardsAccumulatorOf[from] = 0;
        lastTimeOf[from] = block.timestamp;

        claimableRewards -= amount;

        //TODO withdraw claimable rewards
    }

    /// @notice Internal version of `updateStrategyDebtRatio`
    /// @dev Updates the debt ratio for a strategy
    function _updateStrategyDebtRatio(address strategy, uint256 _debtRatio) internal {
        StrategyParameters storage params = strategies[strategy];
        require(params.lastReport != 0, "78"); //TODO Check error message
        debtRatio = debtRatio + _debtRatio - params.debtRatio;
        require(debtRatio <= BASE_PARAMS, "76"); //TODO Check error message
        params.debtRatio = _debtRatio;
        emit StrategyAdded(strategy, debtRatio);
    }

    /*///////////////////////////////////////////////////////////////
                         INTERNAL HOOKS LOGIC
    //////////////////////////////////////////////////////////////*/

    function _beforeWithdraw(uint256 amount) internal {
        _rebalance(amount);
    }

    function _afterDeposit(uint256 amount) internal {
        _rebalance(0);
    }
}
