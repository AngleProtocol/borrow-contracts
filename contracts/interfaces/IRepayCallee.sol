// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

/// @title IRepayCallee
/// @author Angle Core Team
/// @notice Interface for RepayCallee contracts
/// @dev This interface defines the key functions `RepayCallee` contracts should have when interacting with
/// Angle
interface IRepayCallee {
    /// @notice Notifies a contract that an address should be given stablecoins
    /// @param stablecoinRecipient Address to which stablecoins should be sent
    /// @param stablecoinOwed Amount of stablecoins owed to the address
    /// @param collateralObtained Amount of collateral obtained by a related address prior
    /// to the call to this function
    /// @param data Extra data needed (to encode Uniswap swaps for instance)
    function repayCallStablecoin(
        address stablecoinRecipient,
        uint256 stablecoinOwed,
        uint256 collateralObtained,
        bytes calldata data
    ) external;

    /// @notice Notifies a contract that an address should be given collateral
    /// @param collateralRecipient Address to which collateral should be sent
    /// @param stablecoinObtained Amount of stablecoins received by the related address prior to this call
    /// @param collateralOwed Amount of collateral owed by the address
    /// @param data Extra data needed (to encode Uniswap swaps for instance)
    function repayCallCollateral(
        address collateralRecipient,
        uint256 stablecoinObtained,
        uint256 collateralOwed,
        bytes calldata data
    ) external;
}
