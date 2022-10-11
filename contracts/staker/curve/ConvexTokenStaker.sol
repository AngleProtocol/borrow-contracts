// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.12;

import "../../interfaces/external/convex/IBooster.sol";
import "../../interfaces/external/convex/IBaseRewardPool.sol";
import "../../interfaces/external/convex/IClaimZap.sol";
import "../../interfaces/external/convex/ICvxRewardPool.sol";
import "../../interfaces/external/convex/IConvexToken.sol";

import "../BorrowStaker.sol";

/// @title ConvexTokenStaker
abstract contract ConvexTokenStaker is BorrowStaker {
    /// @notice Convex-related constants
    IConvexBooster private constant _CONVEX_BOOSTER = IConvexBooster(0xF403C135812408BFbE8713b5A23a04b3D48AAE31);
    IConvexClaimZap private constant _CONVEX_CLAIM_ZAP = IConvexClaimZap(0xDd49A93FDcae579AE50B4b9923325e9e335ec82B);
    IERC20 private constant _CRV = IERC20(0xD533a949740bb3306d119CC777fa900bA034cd52);
    IConvexToken private constant _CVX = IConvexToken(0x4e3FBD56CD56c3e72c1403e103b45Db9da5B9D2B);

    // ============================= INTERNAL FUNCTIONS ============================

    function _withdrawFromProtocol(uint256 amount) internal override {
        _baseRewardPool().withdrawAndUnwrap(amount, false);
    }

    function _afterTokenTransfer(
        address from,
        address,
        uint256 amount
    ) internal override {
        // Stake on Convex if it is a deposit
        if (from == address(0)) {
            // Deposit the Curve LP tokens into the convex contract and stake
            _changeAllowance(asset, address(_CONVEX_BOOSTER), amount);
            _CONVEX_BOOSTER.deposit(_poolPid(), amount, true);
        }
    }

    /// @dev Should be override by implementation if there are more rewards
    function _claimRewards() internal override {
        // Claim on Convex
        address[] memory rewardContracts = new address[](1);
        rewardContracts[0] = address(_baseRewardPool());

        uint256 prevBalanceCRV = _CRV.balanceOf(address(this));
        uint256 prevBalanceCVX = _CVX.balanceOf(address(this));

        _CONVEX_CLAIM_ZAP.claimRewards(
            rewardContracts,
            new address[](0),
            new address[](0),
            new address[](0),
            0,
            0,
            0,
            0,
            0
        );

        uint256 crvRewards = _CRV.balanceOf(address(this)) - prevBalanceCRV;
        uint256 cvxRewards = _CVX.balanceOf(address(this)) - prevBalanceCVX;

        // do the same thing for additional rewards
        integral[_CRV] += (crvRewards * BASE_PARAMS) / totalSupply();
        integral[_CVX] += (cvxRewards * BASE_PARAMS) / totalSupply();
    }

    function _getRewards() internal pure override returns (IERC20[] memory rewards) {
        rewards = new IERC20[](2);
        rewards[0] = _CRV;
        rewards[1] = _CVX;
        return rewards;
    }

    function _rewardsToBeClaimed(IERC20 rewardToken) internal view override returns (uint256 amount) {
        amount = _baseRewardPool().earned(address(this));
        if (rewardToken == IERC20(address(_CVX))) {
            // Computation made in the Convex token when claiming rewards check
            // https://etherscan.io/address/0x4e3fbd56cd56c3e72c1403e103b45db9da5b9d2b#code
            uint256 totalSupply = _CVX.totalSupply();
            uint256 cliff = totalSupply / _CVX.reductionPerCliff();
            uint256 totalCliffs = _CVX.totalCliffs();
            //mint if below total cliffs
            if (cliff < totalCliffs) {
                //for reduction% take inverse of current cliff
                uint256 reduction = totalCliffs - cliff;
                //reduce
                amount = (amount * reduction) / totalCliffs;

                //supply cap check
                uint256 amtTillMax = _CVX.maxSupply() - totalSupply;
                if (amount > amtTillMax) {
                    amount = amtTillMax;
                }
            }
        }
    }

    // ============================= VIRTUAL FUNCTIONS =============================

    /// @notice Address of the Convex contract on which to claim rewards
    function _baseRewardPool() internal pure virtual returns (IConvexBaseRewardPool);

    /// @notice ID of the pool associated to the AMO on Convex
    function _poolPid() internal pure virtual returns (uint256);
}
