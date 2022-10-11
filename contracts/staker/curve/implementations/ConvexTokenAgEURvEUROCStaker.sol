// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.12;

import "../ConvexTokenStaker.sol";

/// @title ConvexTokenStaker
contract ConvexTokenAgEURvEUROCStaker is ConvexTokenStaker {
    // ============================= VIRTUAL FUNCTIONS =============================

    /// @notice Address of the Convex contract on which to claim rewards
    function _baseRewardPool() internal pure override returns (IConvexBaseRewardPool) {
        return IConvexBaseRewardPool(0xA91fccC1ec9d4A2271B7A86a7509Ca05057C1A98);
    }

    /// @notice ID of the pool associated to the AMO on Convex
    function _poolPid() internal pure override returns (uint256) {
        return 113;
    }
}
