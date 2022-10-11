// SPDX-License-Identifier: AGPL-3.0-only

pragma solidity 0.8.12;

import "./BorrowStakerStorage.sol";

/// @title BorrowStaker
abstract contract BorrowStaker is BorrowStakerStorage, ERC20Upgradeable {
    using SafeERC20 for IERC20;

    /// @notice Initializes the `BorrowStaker`
    function _initialize(IERC20Metadata _asset) internal initializer {
        __ERC20_init_unchained(
            string(abi.encodePacked("Angle ", _asset.name(), " Staker")),
            string(abi.encodePacked("agstk-", _asset.symbol()))
        );
        asset = IERC20(_asset);
    }

    // ================================= MODIFIERS =================================

    /// @notice Checks whether the `msg.sender` has the governor role or not
    modifier onlyGovernor() {
        if (!treasury.isGovernor(msg.sender)) revert NotGovernor();
        _;
    }

    /// @notice Checks whether the `msg.sender` has the governor role or the guardian role
    modifier onlyGovernorOrGuardian() {
        if (!treasury.isGovernorOrGuardian(msg.sender)) revert NotGovernorOrGuardian();
        _;
    }

    // ============================= EXTERNAL FUNCTIONS ============================

    function deposit(uint256 amount, address to) external nonReentrant returns (uint256) {
        // Need to transfer before minting or ERC777s could reenter.
        asset.safeTransferFrom(msg.sender, address(this), amount);
        _mint(to, amount);
        emit Deposit(msg.sender, to, amount);
        return amount;
    }

    function withdraw(
        uint256 amount,
        address from,
        address to
    ) external nonReentrant returns (uint256 shares) {
        if (msg.sender != from) {
            uint256 currentAllowance = allowance(from, msg.sender);
            if (currentAllowance < amount) revert TransferAmountExceedsAllowance();
            if (currentAllowance != type(uint256).max) {
                unchecked {
                    _approve(from, msg.sender, currentAllowance - shares);
                }
            }
        }

        _burn(from, amount);
        emit Withdraw(from, to, amount);
        asset.safeTransfer(to, amount);
    }

    /// @notice Claims earned rewards
    /// @param from Address to claim for
    /// @return rewardAmounts Amounts claimed by the user
    function claimRewards(address from) external nonReentrant returns (uint256[] memory rewardAmounts) {
        address[] memory checkpointUser = new address[](1);
        checkpointUser[0] = address(from);
        rewardAmounts = _checkpoint(checkpointUser, true)[0];
    }

    /// @dev Goves the exact amount that will be received if called `claim(_user)` for a specific reward token
    function claimableRewards(address _user, IERC20 _rewardToken) external view returns (uint256) {
        uint256 newIntegral = integral[_rewardToken] +
            (_rewardsToBeClaimed(_rewardToken) * BASE_PARAMS) /
            totalSupply();
        uint256 userIntegral = integralOf[_rewardToken][_user];
        uint256 newClaimable = (balanceOf(_user) * (newIntegral - userIntegral)) / BASE_PARAMS;
        return pendingRewardsOf[_rewardToken][_user] + newClaimable;
    }

    // ============================ GOVERNANCE FUNCTIONS ===========================

    /// @notice Changes the treasury contract
    /// @dev Like the function above, this permissionless function just adjusts the treasury to
    /// the address of the treasury contract from the `VaultManager` in case it has been modified
    function setTreasury(ITreasury _treasury) external onlyGovernor {
        treasury = _treasury;
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
        checkpointUser[0] = address(_from);
        checkpointUser[1] = address(_to);

        _checkpoint(checkpointUser, _claim);
        // If the user is trying to withdraw we need to withdraw from the other protocol
        if (_to == address(0)) _withdrawFromProtocol(amount);
    }

    /// @return rewardAmounts An array of array where the 1st array represent the rewards earned by `from`
    /// and the 2nd one represent the earnings of `to`
    function _checkpoint(address[] memory accounts, bool _claim) internal returns (uint256[][] memory rewardAmounts) {
        _claimRewards();

        rewardAmounts = new uint256[][](accounts.length);
        for (uint256 i = 0; i < accounts.length; ++i) {
            if (accounts[i] == address(0)) continue;
            rewardAmounts[i] = _checkpointRewardsUser(accounts[i], _claim);
        }
    }

    /// @notice Claims rewards earned by a user
    /// @param from Address to claim rewards from
    /// @param _claim Whether to claim or not the rewards
    /// @return rewardAmounts Amounts earned by the user
    /// @dev Function will revert if there has been no mint
    function _checkpointRewardsUser(address from, bool _claim) internal returns (uint256[] memory rewardAmounts) {
        IERC20[] memory rewardsToken = _getRewards();
        rewardAmounts = new uint256[](rewardsToken.length);
        for (uint256 i = 0; i < rewardsToken.length; ++i) {
            uint256 userIntegral = integralOf[rewardsToken[i]][from];
            uint256 newClaimable = (balanceOf(from) * (integral[rewardsToken[i]] - userIntegral)) / BASE_PARAMS;
            if (newClaimable > 0) {
                if (_claim) {
                    rewardsToken[i].safeTransfer(from, pendingRewardsOf[rewardsToken[i]][from] + newClaimable);
                    pendingRewardsOf[rewardsToken[i]][from] = 0;
                } else {
                    pendingRewardsOf[rewardsToken[i]][from] += newClaimable;
                }
                integralOf[rewardsToken[i]][from] = integral[rewardsToken[i]];
            }
            rewardAmounts[i] = newClaimable;
        }
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

    /// @dev Should increase the claimableRewards
    function _claimRewards() internal virtual;

    function _getRewards() internal pure virtual returns (IERC20[] memory reward);

    function _withdrawFromProtocol(uint256 amount) internal virtual;

    // For some staker this may not be precise (lower bound)
    function _rewardsToBeClaimed(IERC20 rewardToken) internal view virtual returns (uint256 amount);
}
