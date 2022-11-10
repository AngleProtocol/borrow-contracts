// SPDX-License-Identifier: AGPL-3.0-only

pragma solidity 0.8.12;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import "../interfaces/ICoreBorrow.sol";
import { IVaultManagerListing } from "../interfaces/IVaultManager.sol";

/// @title MockBorrowStaker
/// @author Angle Core Team
contract MockBorrowStakerImplem is ERC20 {
    using SafeERC20 for IERC20;

    error IncompatibleLengths();

    IERC20 public rewardToken;
    uint256 public rewardAmount;

    /// @notice Base used for parameter computation
    /// @dev Large base because when `(amount * BASE_PARAMS) / totalSupply()` if `amount << totalSupply`
    /// rounding can be terrible. Setting the base higher limits the maximum decimals a reward can have - overflows.
    uint256 public constant BASE_PARAMS = 10**36;

    // ================================= REFERENCES ================================

    /// @notice Reference to the staked token
    IERC20 public asset;
    /// @notice Core borrow contract handling access control
    ICoreBorrow public coreBorrow;

    // ================================= VARIABLES =================================

    /// @notice Token decimal
    uint8 internal _decimals;
    uint32 internal _lastRewardsClaimed;
    /// @notice List of all the vaultManager which have the staker as collateral
    IVaultManagerListing[] internal _vaultManagers;
    /// @notice Maps an address to whether it is a compatible `VaultManager` that has this contract
    /// as a collateral
    mapping(address => uint256) public isCompatibleVaultManager;
    /// @notice Maps each reward token to a track record of cumulated rewards
    mapping(IERC20 => uint256) public integral;
    /// @notice Maps pairs of `(token,user)` to the currently pending claimable rewards
    mapping(IERC20 => mapping(address => uint256)) public pendingRewardsOf;
    /// @notice Maps pairs of `(token,user)` to a track record of cumulated personal rewards
    mapping(IERC20 => mapping(address => uint256)) public integralOf;

    uint256[43] private __gap;

    // =================================== EVENTS ==================================

    event Deposit(address indexed from, address indexed to, uint256 amount);
    event Withdraw(address indexed from, address indexed to, uint256 amount);
    event Recovered(address indexed token, address indexed to, uint256 amount);

    // =================================== ERRROS ==================================

    error InvalidToken();
    error NotGovernor();
    error NotGovernorOrGuardian();
    error TransferAmountExceedsAllowance();
    error ZeroAddress();
    error InvalidVaultManager();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(ICoreBorrow _coreBorrow, IERC20Metadata _asset)
        ERC20(
            string(abi.encodePacked("Angle ", _asset.name(), " Staker")),
            string(abi.encodePacked("agstk-", _asset.symbol()))
        )
    {
        coreBorrow = _coreBorrow;
        asset = IERC20(_asset);
        _decimals = _asset.decimals();
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

    // =============================== VIEW FUNCTIONS ==============================

    /// @notice Gets the list of all the `VaultManager` contracts which have this token
    /// as a collateral
    function getVaultManagers() public view returns (IVaultManagerListing[] memory) {
        return _vaultManagers;
    }

    // ============================= EXTERNAL FUNCTIONS ============================

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    /// @notice Deposits the token to get the wrapped version
    /// @param amount Amount of token to be staked
    /// @param to Address for which the token is deposited
    function deposit(uint256 amount, address to) external returns (uint256) {
        // Need to transfer before minting or ERC777s could reenter.
        asset.safeTransferFrom(msg.sender, address(this), amount);
        _mint(to, amount);
        emit Deposit(msg.sender, to, amount);
        return amount;
    }

    /// @notice Withdraws the token from the same amount of wrapped token
    /// @param amount Amount of token to be unstaked
    /// @param from Address from which the token will be withdrawn
    /// @param to Address which will receive the token
    function withdraw(
        uint256 amount,
        address from,
        address to
    ) external returns (uint256) {
        if (msg.sender != from) {
            uint256 currentAllowance = allowance(from, msg.sender);
            if (currentAllowance < amount) revert TransferAmountExceedsAllowance();
            if (currentAllowance != type(uint256).max) {
                unchecked {
                    _approve(from, msg.sender, currentAllowance - amount);
                }
            }
        }
        _burn(from, amount);
        emit Withdraw(from, to, amount);
        asset.safeTransfer(to, amount);
        return amount;
    }

    /// @notice Claims earned rewards for user `from`
    /// @param from Address to claim for
    /// @return rewardAmounts Amounts of each reward token claimed by the user
    function claimRewards(address from) external returns (uint256[] memory) {
        address[] memory checkpointUser = new address[](1);
        checkpointUser[0] = address(from);
        return _checkpoint(checkpointUser, true);
    }

    /// @notice Checkpoints the rewards earned by user `from`
    /// @param from Address to checkpoint for
    function checkpoint(address from) external {
        address[] memory checkpointUser = new address[](1);
        checkpointUser[0] = address(from);
        _checkpoint(checkpointUser, false);
    }

    /// @notice Gets the full `asset` balance of `from`
    /// @param from Address to check the full balance of
    /// @dev The returned value takes into account the balance currently held by `from` and the balance held by `VaultManager`
    /// contracts on behalf of `from`
    function totalBalanceOf(address from) public view returns (uint256 totalBalance) {
        if (isCompatibleVaultManager[from] == 1) return 0;
        // If `from` is one of the whitelisted vaults, do not consider the rewards to not double count balances
        IVaultManagerListing[] memory vaultManagerContracts = _vaultManagers;
        totalBalance = balanceOf(from);
        for (uint256 i; i < vaultManagerContracts.length; i++) {
            totalBalance += vaultManagerContracts[i].getUserCollateral(from);
        }
        return totalBalance;
    }

    /// @notice Returns the exact amount that will be received if calling `claimRewards(from)` for a specific reward token
    /// @param from Address to claim for
    /// @param _rewardToken Token to get rewards for
    function claimableRewards(address from, IERC20 _rewardToken) external view returns (uint256) {
        uint256 _totalSupply = totalSupply();
        uint256 newIntegral = _totalSupply > 0
            ? integral[_rewardToken] + (_rewardsToBeClaimed(_rewardToken) * BASE_PARAMS) / _totalSupply
            : integral[_rewardToken];
        uint256 newClaimable = (totalBalanceOf(from) * (newIntegral - integralOf[_rewardToken][from])) / BASE_PARAMS;
        return pendingRewardsOf[_rewardToken][from] + newClaimable;
    }

    // ============================ GOVERNANCE FUNCTIONS ===========================

    /// @notice Changes the core borrow contract
    /// @param _coreBorrow Address of the new core borrow contract
    function setCoreBorrow(ICoreBorrow _coreBorrow) external onlyGovernor {
        if (!_coreBorrow.isGovernor(msg.sender)) revert NotGovernor();
        coreBorrow = _coreBorrow;
    }

    /// @notice Adds to the tracking list a `vaultManager` which has as collateral the `asset`
    /// @param vaultManager Address of the new `vaultManager` to add to the list
    function addVaultManager(IVaultManagerListing vaultManager) external onlyGovernorOrGuardian {
        if (
            address(vaultManager.collateral()) != address(asset) || isCompatibleVaultManager[address(vaultManager)] == 1
        ) revert InvalidVaultManager();
        isCompatibleVaultManager[address(vaultManager)] = 1;
        _vaultManagers.push(vaultManager);
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
        if (tokenAddress == address(asset)) revert InvalidToken();
        IERC20(tokenAddress).safeTransfer(to, amountToRecover);
        emit Recovered(tokenAddress, to, amountToRecover);
    }

    // ============================= INTERNAL FUNCTIONS ============================

    function _beforeTokenTransfer(
        address _from,
        address _to,
        uint256 amount
    ) internal override {
        // Not claiming only if it is a deposit
        bool _claim = !(_from == address(0));

        address[] memory checkpointUser = new address[](2);
        checkpointUser[0] = _from;
        checkpointUser[1] = _to;
        _checkpoint(checkpointUser, _claim);
        // If the user is trying to withdraw we need to withdraw from the other protocol
        if (_to == address(0)) _withdrawFromProtocol(amount);
    }

    /// @notice Claims contracts rewards and checkpoints for different `accounts`
    /// @param accounts Array of accounts we should checkpoint rewards for
    /// @param _claim Whether to claim for `accounts` the pending rewards
    /// @return rewardAmounts An array representing the rewards earned by the first address in the `accounts` array
    /// on each of the reward token
    /// @dev `rewardAmounts` is a one dimension array because n-dimensional arrays are only supported by internal functions
    /// The `accounts` array need to be ordered to get the rewards for a specific account
    function _checkpoint(address[] memory accounts, bool _claim) internal returns (uint256[] memory rewardAmounts) {
        // Cautious with this line, we need to be sure that rewards are not distributed in one time without
        // linear vesting otherwise reward can be sent to the wrong owners.
        // This should not be a hard requirement as this kind of distribution seems disastrous and front runnable
        if (_lastRewardsClaimed != block.timestamp) {
            _claimRewards();
            _lastRewardsClaimed = uint32(block.timestamp);
        }
        for (uint256 i = 0; i < accounts.length; ++i) {
            if (accounts[i] == address(0) || isCompatibleVaultManager[accounts[i]] == 1) continue;
            if (i == 0) rewardAmounts = _checkpointRewardsUser(accounts[i], _claim);
            else _checkpointRewardsUser(accounts[i], _claim);
        }
    }

    /// @notice Checkpoints rewards earned by a user
    /// @param from Address to claim rewards from
    /// @param _claim Whether to claim or not the rewards
    /// @return rewardAmounts Amounts of the different reward tokens earned by the user
    function _checkpointRewardsUser(address from, bool _claim) internal returns (uint256[] memory rewardAmounts) {
        IERC20[] memory rewardTokens = _getRewards();
        rewardAmounts = new uint256[](rewardTokens.length);
        uint256 userBalance = totalBalanceOf(from);
        for (uint256 i = 0; i < rewardTokens.length; ++i) {
            uint256 newClaimable = (userBalance * (integral[rewardTokens[i]] - integralOf[rewardTokens[i]][from])) /
                BASE_PARAMS;
            uint256 previousClaimable = pendingRewardsOf[rewardTokens[i]][from];
            if (_claim && previousClaimable + newClaimable > 0) {
                rewardTokens[i].safeTransfer(from, previousClaimable + newClaimable);
                pendingRewardsOf[rewardTokens[i]][from] = 0;
            } else if (newClaimable > 0) {
                pendingRewardsOf[rewardTokens[i]][from] += newClaimable;
            }
            integralOf[rewardTokens[i]][from] = integral[rewardTokens[i]];
            rewardAmounts[i] = previousClaimable + newClaimable;
        }
    }

    /// @notice Adds the contract claimed rewards to the distributed rewards
    /// @param rewardToken Reward token that must be updated
    /// @param amount Amount to add to the claimable rewards
    function _updateRewards(IERC20 rewardToken, uint256 amount) internal {
        uint256 _totalSupply = totalSupply();
        if (_totalSupply > 0) integral[rewardToken] += (amount * BASE_PARAMS) / _totalSupply;
    }

    /// @notice Changes allowance of this contract for a given token
    /// @param token Address of the token for which allowance should be changed
    /// @param spender Address to approve
    /// @param amount Amount to approve
    function _changeAllowance(
        IERC20 token,
        address spender,
        uint256 amount
    ) internal {
        uint256 currentAllowance = token.allowance(address(this), spender);
        if (currentAllowance < amount) {
            token.safeIncreaseAllowance(spender, amount - currentAllowance);
        } else if (currentAllowance > amount) {
            token.safeDecreaseAllowance(spender, currentAllowance - amount);
        }
    }

    /// @notice Changes allowance of a set of tokens to addresses
    /// @param tokens Tokens to change allowance for
    /// @param spenders Addresses to approve
    /// @param amounts Approval amounts for each address
    /// @dev You can only change allowance for approved strategies
    function changeAllowance(
        IERC20[] calldata tokens,
        address[] calldata spenders,
        uint256[] calldata amounts
    ) external onlyGovernor {
        if (tokens.length != amounts.length || spenders.length != amounts.length || tokens.length == 0)
            revert IncompatibleLengths();
        for (uint256 i = 0; i < spenders.length; i++) {
            _changeAllowance(tokens[i], spenders[i], amounts[i]);
        }
    }

    function _withdrawFromProtocol(uint256 amount) internal {}

    /// @dev Should be overriden by the implementation if there are more rewards
    function _claimRewards() internal virtual {
        _updateRewards(rewardToken, rewardAmount);
    }

    function _getRewards() internal view returns (IERC20[] memory rewards) {
        rewards = new IERC20[](1);
        rewards[0] = rewardToken;
        return rewards;
    }

    function _rewardsToBeClaimed(IERC20) internal view returns (uint256 amount) {
        amount = rewardAmount;
    }

    function setRewardToken(IERC20 token) public {
        rewardToken = token;
    }

    function setRewardAmount(uint256 amount) public {
        rewardAmount = amount;
    }
}
