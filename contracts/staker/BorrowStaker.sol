// SPDX-License-Identifier: AGPL-3.0-only

pragma solidity 0.8.12;

import "./BorrowStakerStorage.sol";

/// @title BorrowStaker
/// @author Angle Core Team
/// @dev Staking contract keeping track of user rewards and minting a wrapper token
/// that can be hassle free on any other protocol without loosing the rewards.
/// @dev If Angle is to accept a Curve LP token accruing CRV rewards, what is to be a collateral on the Borrowing module
/// is not going to be the LP token in itself, but the token corresponding to this type of contract
abstract contract BorrowStaker is BorrowStakerStorage, ERC20Upgradeable {
    using SafeERC20 for IERC20;

    /// @notice Initializes the `BorrowStaker`
    function initialize(ICoreBorrow _coreBorrow, IERC20Metadata _asset) external initializer {
        __ERC20_init_unchained(
            string(abi.encodePacked("Angle ", _asset.name(), " Staker")),
            string(abi.encodePacked("agstk-", _asset.symbol()))
        );
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
        uint256[] memory rewardAmounts = new uint256[](1);
        checkpointUser[0] = address(from);
        return _checkpoint(checkpointUser, true, rewardAmounts);
    }

    /// @notice Returns the exact amount that will be received if called `claimRewards(from)` for a specific reward token
    /// @param from Address to claim for
    /// @param _rewardToken Token to get rewards for
    function claimableRewards(address from, IERC20 _rewardToken) external view returns (uint256) {
        uint256 _totalSupply = totalSupply();
        uint256 newIntegral = _totalSupply > 0
            ? integral[_rewardToken] + (_rewardsToBeClaimed(_rewardToken) * BASE_PARAMS) / totalSupply()
            : integral[_rewardToken];
        uint256 newClaimable = (balanceOf(from) * (newIntegral - integralOf[_rewardToken][from])) / BASE_PARAMS;
        return pendingRewardsOf[_rewardToken][from] + newClaimable;
    }

    // ============================ GOVERNANCE FUNCTIONS ===========================

    /// @notice Changes the core borrow contract
    /// @param _coreBorrow Address of the new core borrow contract
    function setCoreBorrow(ICoreBorrow _coreBorrow) external onlyGovernor {
        if (!_coreBorrow.isGovernor(msg.sender)) revert NotGovernor();
        coreBorrow = _coreBorrow;
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

    /// @inheritdoc ERC20Upgradeable
    function _beforeTokenTransfer(
        address _from,
        address _to,
        uint256 amount
    ) internal override {
        // Not claiming only if it is a deposit
        bool _claim = !(_from == address(0));

        address[] memory checkpointUser = new address[](2);
        uint256[] memory rewardAmounts = new uint256[](1);
        checkpointUser[0] = address(_from);
        checkpointUser[1] = address(_to);
        _checkpoint(checkpointUser, _claim, rewardAmounts);
        // If the user is trying to withdraw we need to withdraw from the other protocol
        if (_to == address(0)) _withdrawFromProtocol(amount);
    }

    /// @notice Claims contracts rewards and checkpoints for different `accounts`
    /// @param accounts Array of accounts we should checkpoint rewards for
    /// @param _claim Whether to claim for `accounts` the pending rewards
    /// @param rewardAmounts Reward amount list specifying all tokens claimed or claimable
    /// @return rewardAmounts An array of array where the 1st array represents the rewards earned by `from`
    /// and the 2nd one represents the earnings of `to`
    /// @dev `rewardAmounts`is a one dimension array because n-dimensional arrays are only supported by internal functions
    /// You can order the `accounts` to get the rewards for a specific account
    function _checkpoint(
        address[] memory accounts,
        bool _claim,
        uint256[] memory rewardAmounts
    ) internal returns (uint256[] memory) {
        _claimRewards();

        for (uint256 i = 0; i < accounts.length; ++i) {
            if (accounts[i] == address(0)) continue;
            if (i == 0) rewardAmounts = _checkpointRewardsUser(accounts[i], _claim);
            else _checkpointRewardsUser(accounts[i], _claim);
        }
        return rewardAmounts;
    }

    /// @notice Checkpoints rewards earned by a user
    /// @param from Address to claim rewards from
    /// @param _claim Whether to claim or not the rewards
    /// @return rewardAmounts Amounts of the different reward tokens earned by the user
    function _checkpointRewardsUser(address from, bool _claim) internal returns (uint256[] memory rewardAmounts) {
        IERC20[] memory rewardTokens = _getRewards();
        rewardAmounts = new uint256[](rewardTokens.length);
        for (uint256 i = 0; i < rewardTokens.length; ++i) {
            uint256 newClaimable = (balanceOf(from) * (integral[rewardTokens[i]] - integralOf[rewardTokens[i]][from])) /
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
        if (_totalSupply > 0) integral[rewardToken] += (amount * BASE_PARAMS) / totalSupply();
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

    // ============================= VIRTUAL FUNCTIONS =============================

    /// @notice Claims all available rewards and increases the associated integral
    function _claimRewards() internal virtual;

    /// @notice Returns a list of all reward tokens supported by this contract
    function _getRewards() internal view virtual returns (IERC20[] memory reward);

    /// @notice Withdraws the staking token from the protocol rewards contract
    function _withdrawFromProtocol(uint256 amount) internal virtual;

    /// @notice Checks all unclaimed rewards in `rewardToken`
    /// @dev For some `rewardToken` this may not be precise (i.e lower bound) on what can be claimed
    function _rewardsToBeClaimed(IERC20 rewardToken) internal view virtual returns (uint256 amount);
}
