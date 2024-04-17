// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.5.0;

import { IERC4626 } from "borrow-contracts/interfaces/external/IERC4626.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

/// @title IOracle
/// @author Morpho Labs
/// @custom:contact security@morpho.org
/// @notice Interface that oracles used by Morpho must implement.
/// @dev It is the user's responsibility to select markets with safe oracles.
interface IOracleMorpho {
    /// @notice Returns the price of 1 asset of collateral token quoted in 1 asset of loan token, scaled by 1e36.
    /// @dev It corresponds to the price of 10**(collateral token decimals) assets of collateral token quoted in
    /// 10**(loan token decimals) assets of loan token with `36 + loan token decimals - collateral token decimals`
    /// decimals of precision.
    function price() external view returns (uint256);
}

/// @title IMorphoChainlinkOracleV2
/// @author Morpho Labs
/// @custom:contact security@morpho.org
/// @notice Interface of MorphoChainlinkOracleV2.
interface IMorphoChainlinkOracleV2 is IOracleMorpho {
    /// @notice Returns the address of the base ERC4626 vault.
    function BASE_VAULT() external view returns (IERC4626);

    /// @notice Returns the base vault conversion sample.
    function BASE_VAULT_CONVERSION_SAMPLE() external view returns (uint256);

    /// @notice Returns the address of the quote ERC4626 vault.
    function QUOTE_VAULT() external view returns (IERC4626);

    /// @notice Returns the quote vault conversion sample.
    function QUOTE_VAULT_CONVERSION_SAMPLE() external view returns (uint256);

    /// @notice Returns the address of the first base feed.
    function BASE_FEED_1() external view returns (AggregatorV3Interface);

    /// @notice Returns the address of the second base feed.
    function BASE_FEED_2() external view returns (AggregatorV3Interface);

    /// @notice Returns the address of the first quote feed.
    function QUOTE_FEED_1() external view returns (AggregatorV3Interface);

    /// @notice Returns the address of the second quote feed.
    function QUOTE_FEED_2() external view returns (AggregatorV3Interface);

    /// @notice Returns the price scale factor, calculated at contract creation.
    function SCALE_FACTOR() external view returns (uint256);
}
