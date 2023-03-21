// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import { IChainlinkAggregator } from "../interfaces/IChainlinkAggregator.sol";
import { ICLSynchronicityPriceAdapter } from "../interfaces/ICLSynchronicityPriceAdapter.sol";
import { IERC4626 } from "../interfaces/external/IERC4626.sol";

/**
 * @title sDAISynchronicityPriceAdapter
 * @author BGD Labs
 * @notice Price adapter to calculate price of (stEUR / USD) pair by using
 * @notice Chainlink Data Feeds for (agEUR / EUR), (EUR / USD) and rate provider for (stEUR / EUR).
 */
contract stEURSynchronicityPriceAdapter is ICLSynchronicityPriceAdapter {
    /**
     * @notice Price feed for (agEUR / EUR) pair
     */
    IChainlinkAggregator public immutable AGEUR_TO_EUR;

    /**
     * @notice Price feed for (EUR / USD) pair
     */
    IChainlinkAggregator public immutable EUR_TO_USD;

    /**
     * @notice rate provider for (stEUR / agEUR)
     */
    IERC4626 public immutable RATE_PROVIDER;

    /**
     * @notice Number of decimals for stEUR / EUR ratio
     */
    uint8 public constant RATIO_DECIMALS = 18;

    /**
     * @notice Number of decimals in the output of this price adapter
     */
    uint8 public immutable DECIMALS;

    uint8 public immutable AGEUR_TO_EUR_DECIMALS;

    string private _description;

    /**
     * @param agEURToEURAggregatorAddress the address of agEUR / EUR feed
     * @param eurToUSDAggregatorAddress the address of EUR / USD feed
     * @param rateProviderAddress the address of the rate provider
     * @param pairName name identifier
     */
    constructor(
        address agEURToEURAggregatorAddress,
        address eurToUSDAggregatorAddress,
        address rateProviderAddress,
        string memory pairName
    ) {
        AGEUR_TO_EUR = IChainlinkAggregator(agEURToEURAggregatorAddress);
        EUR_TO_USD = IChainlinkAggregator(eurToUSDAggregatorAddress);
        RATE_PROVIDER = IERC4626(rateProviderAddress);

        AGEUR_TO_EUR_DECIMALS = AGEUR_TO_EUR.decimals();
        DECIMALS = EUR_TO_USD.decimals();

        _description = pairName;
    }

    /// @inheritdoc ICLSynchronicityPriceAdapter
    function description() external view returns (string memory) {
        return _description;
    }

    /// @inheritdoc ICLSynchronicityPriceAdapter
    function decimals() external view returns (uint8) {
        return DECIMALS;
    }

    /// @inheritdoc ICLSynchronicityPriceAdapter
    function latestAnswer() public view virtual override returns (int256) {
        int256 agEURToEUR = AGEUR_TO_EUR.latestAnswer();
        int256 eurToUSDPrice = EUR_TO_USD.latestAnswer();
        int256 ratio = int256(RATE_PROVIDER.convertToAssets(1e18));

        if (agEURToEUR <= 0 || eurToUSDPrice <= 0 || ratio <= 0) {
            return 0;
        }

        return (agEURToEUR * eurToUSDPrice * ratio) / int256((10 ** RATIO_DECIMALS) * (10 ** AGEUR_TO_EUR_DECIMALS));
    }
}
