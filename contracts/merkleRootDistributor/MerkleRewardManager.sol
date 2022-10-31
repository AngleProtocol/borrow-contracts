// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../interfaces/ICoreBorrow.sol";

struct Reward {
    // Address of the UniswapV3 pool that needs to be incentivized
    address uniV3Pool;
    // Address of the reward token for the incentives
    address token;
    // Amount of `token` to distribute
    uint256 amount;
    // Address responsible for the reward: unused at the moment as a reward is immutable
    // but might help in future settings (suggesting UniV3 wrappers, updating rewards, ...)
    address manager;
    // In the incentivization formula, how much of the fees should go
    uint32 propToken1;
    // Proportion for holding token2
    uint32 propToken2;
    // Proportion for simply providing a useful liquidity
    uint32 propFees;
    // Whether out of range liquidity should still be incentivized or not
    uint32 outOfRangeIncentivized;
    // Timestamp at which the incentivization should start
    uint32 epochStart;
    // Amount of epochs for which incentivization should last
    uint32 numEpoch;
}

/* TODO for the script
- check whether the uniV3 pool is actually one or not
- automatically ERC20 token addresses which own the position
- what happens if rewards sent to a pool with no fees at all
*/

/// @title MerkleRewardManager
/// @author Angle Labs, Inc.
/// @notice Manages the distribution of rewards across different UniswapV3 pools
/// @dev This contract is mostly a helper for APIs getting built on top and helping in Angle
/// UniswapV3 incentivization scheme
contract MerkleRewardManager is Initializable {
    using SafeERC20 for IERC20;
    /// @notice Epoch duration
    uint32 public constant EPOCH_DURATION = 24 * 3600 * 7;

    /// @notice `CoreBorrow` contract handling access control
    ICoreBorrow public coreBorrow;
    /// @notice User contract for distributing rewards
    address public merkleRootDistributor;
    /// @notice List of all rewards ever distributed or to be distributed in the contract
    Reward[] public rewardList;

    uint256[47] private __gap;

    // ============================== ERRORS / EVENTS ==============================

    event MerkleRootDistributorUpdated(address indexed _merkleRootDistributor);
    event NewReward(Reward reward);

    error InvalidReward();
    error InvalidParam();
    error NotGovernorOrGuardian();
    error ZeroAddress();

    // ================================== MODIFIER =================================

    /// @notice Checks whether the `msg.sender` has the governor role or the guardian role
    modifier onlyGovernorOrGuardian() {
        if (!coreBorrow.isGovernorOrGuardian(msg.sender)) revert NotGovernorOrGuardian();
        _;
    }

    // ================================ CONSTRUCTOR ================================

    constructor() initializer {}

    function initialize(ICoreBorrow _coreBorrow, address _merkleRootDistributor) public initializer {
        if (address(_coreBorrow) == address(0) || _merkleRootDistributor == address(0)) revert ZeroAddress();
        merkleRootDistributor = _merkleRootDistributor;
        coreBorrow = _coreBorrow;
    }

    // ============================== DEPOSIT FUNCTION =============================

    // uniV3Pool, proportionTokenA, propTokenB, propFees, periodStart, epochAmount, token, bool outOfRange, amountOfTokens
    /// @notice Deposits a reward `reward`
    function depositReward(Reward memory reward) external {
        uint256 epochStart = _getRoundedEpoch(reward.epochStart);
        // Reward will not be accepted in the following conditions:
        if (
            // TODO better check for if UniV3 pool
            // If the pool to incentivize is not a contract
            reward.uniV3Pool.code.length == 0 ||
            // If epoch parameters would lead to a past distribution
            epochStart + EPOCH_DURATION < block.timestamp ||
            // If the amount of epochs for which this incentive should last is zero
            reward.numEpoch == 0 ||
            // If the amount to use to incentivize is still 0
            reward.amount == 0
        ) revert InvalidReward();
        if (reward.manager == address(0)) reward.manager = msg.sender;
        IERC20(reward.token).safeTransferFrom(msg.sender, merkleRootDistributor, reward.amount);
        rewardList.push(reward);
        emit NewReward(reward);
    }

    // ================================= UI HELPERS ================================
    // These functions are not to be queried on-chain and hence are not optimized for gas consumption

    /// @notice Returns the list of all rewards ever distributed or to be distributed
    function getAllRewards() external view returns (Reward[] memory) {
        return rewardList;
    }

    /// @notice Returns the list of all currently active rewards on UniswapV3 pool
    function getActiveRewards() external view returns (Reward[] memory) {
        return _getRewardsForEpoch(_getRoundedEpoch(uint32(block.timestamp)));
    }

    /// @notice Returns the list of all the rewards that were or that are going to be live at
    /// a specific epoch
    function getRewardsForEpoch(uint32 epoch) external view returns (Reward[] memory) {
        return _getRewardsForEpoch(_getRoundedEpoch(epoch));
    }

    /// @notice Returns the list of all currently active rewards for a specific UniswapV3 pool
    function getActivePoolRewards(address uniV3Pool) external view returns (Reward[] memory) {
        return _getPoolRewardsForEpoch(uniV3Pool, _getRoundedEpoch(uint32(block.timestamp)));
    }

    /// @notice Returns the list of all the rewards that were or that are going to be live at a
    /// specific epoch and for a specific pool
    function getPoolRewardsForEpoch(address uniV3Pool, uint32 epoch) external view returns (Reward[] memory) {
        return _getPoolRewardsForEpoch(uniV3Pool, _getRoundedEpoch(epoch));
    }

    // ============================ GOVERNANCE FUNCTION ============================

    /// @notice Sets a new `merkleRootDistributor` to which rewards should be distributed
    function setNewMerkleRootDistributor(address _merkleRootDistributor) external onlyGovernorOrGuardian {
        if (_merkleRootDistributor == address(0)) revert InvalidParam();
        merkleRootDistributor = _merkleRootDistributor;
        emit MerkleRootDistributorUpdated(_merkleRootDistributor);
    }

    // ============================== INTERNAL HELPERS =============================

    /// @notice Rounds an `epoch` timestamp to the start of the corresponding period
    function _getRoundedEpoch(uint32 epoch) internal pure returns (uint32) {
        return (epoch / EPOCH_DURATION) * EPOCH_DURATION;
    }

    /// @notice Checks whether `reward` was live at `roundedEpoch`
    function _isRewardLiveForEpoch(Reward storage reward, uint32 roundedEpoch) internal view returns (bool) {
        return reward.epochStart + reward.numEpoch * EPOCH_DURATION > roundedEpoch;
    }

    /// @notice Gets the list of all active rewards during the epoch which started at `epochStart`
    function _getRewardsForEpoch(uint32 epochStart) internal view returns (Reward[] memory) {
        uint256 length;
        for (uint32 i = 0; i < rewardList.length; ) {
            Reward storage reward = rewardList[i];
            if (_isRewardLiveForEpoch(reward, epochStart)) length += 1;
            unchecked {
                ++i;
            }
        }

        Reward[] memory activeRewards = new Reward[](length);
        uint256 j;
        for (uint32 i = 0; i < rewardList.length && j < length; ) {
            Reward storage reward = rewardList[i];
            if (_isRewardLiveForEpoch(reward, epochStart)) {
                activeRewards[j] = reward;
                unchecked {
                    ++j;
                }
            }
            unchecked {
                ++i;
            }
        }
        return activeRewards;
    }

    /// @notice Gets the list of all active rewards for `uniV3Pool` during the epoch which started at `epochStart`
    function _getPoolRewardsForEpoch(address uniV3Pool, uint32 epochStart) internal view returns (Reward[] memory) {
        uint256 length;
        for (uint32 i = 0; i < rewardList.length; ) {
            Reward storage reward = rewardList[i];
            if (reward.uniV3Pool == uniV3Pool && _isRewardLiveForEpoch(reward, epochStart)) length += 1;
            unchecked {
                ++i;
            }
        }

        Reward[] memory activeRewards = new Reward[](length);
        uint256 j;
        for (uint32 i = 0; i < rewardList.length && j < length; ) {
            Reward storage reward = rewardList[i];
            if (reward.uniV3Pool == uniV3Pool && _isRewardLiveForEpoch(reward, epochStart)) {
                activeRewards[j] = reward;
                unchecked {
                    ++j;
                }
            }
            unchecked {
                ++i;
            }
        }
        return activeRewards;
    }
}
