// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

import "../../../BaseOracleChainlinkMultiTwoFeeds.sol";
import "../../../../interfaces/external/IERC4626.sol";

/// @title OracleSTEURETHChainlinkArbitrum
/// @author Angle Labs, Inc.
/// @notice Gives the price of stEUR in ETH in base 18
contract OracleSTEURETHChainlinkArbitrum is BaseOracleChainlinkMultiTwoFeeds, AggregatorV3Interface {
    string public constant DESCRIPTION = "stEUR/ETH Oracle";
    IERC4626 public constant STEUR = IERC4626(0x004626A008B1aCdC4c74ab51644093b155e59A23);

    constructor(uint32 _stalePeriod, address _treasury) BaseOracleChainlinkMultiTwoFeeds(_stalePeriod, _treasury) {}

    /// @inheritdoc IOracle
    function circuitChainlink() public pure override returns (AggregatorV3Interface[] memory) {
        AggregatorV3Interface[] memory _circuitChainlink = new AggregatorV3Interface[](2);
        // Oracle agEUR/USD - Redstone
        _circuitChainlink[0] = AggregatorV3Interface(0x37963F10245e7c3a10c0E9d43a6E617B4Bc8440A);
        // Oracle ETH/USD - Chainlink
        _circuitChainlink[1] = AggregatorV3Interface(0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612);
        return _circuitChainlink;
    }

    /// @inheritdoc BaseOracleChainlinkMultiTwoFeeds
    function _getQuoteAmount() internal view override returns (uint256) {
        return STEUR.convertToAssets(1 ether);
    }

    /*//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                           CHAINLINK INTERFACE COMPATIBILITY                                        
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////*/

    /// @inheritdoc AggregatorV3Interface
    function decimals() external pure returns (uint8) {
        return 18;
    }

    /// @inheritdoc AggregatorV3Interface
    function description() external pure returns (string memory desc) {
        desc = "Angle stEUR/ETH Price Feed";
    }

    /// @inheritdoc AggregatorV3Interface
    function version() external pure returns (uint256) {
        return 1;
    }

    /// @inheritdoc AggregatorV3Interface
    /// @return roundID
    /// @return aggregatorPrice
    /// @return startedAt
    /// @return timestamp
    /// @return answeredInRound
    /// @dev The `roundId`, `startedAt` and `answeredInRound` values return in this function must be disregarded
    /// @dev In order not to multiply oracle calls, the timestamp returned here is the `block.timestamp`.
    /// The contract still performs an heartbeat check for every oracle value that it reads, and the accurate
    /// value of the `timestamp` (if this one is taken as the minimum between the last update timestamp
    /// of the two oracles) is between: current timestamp and the current timestamp minus `stalePeriod`
    function latestRoundData() public view returns (uint80, int256, uint256, uint256, uint80) {
        return (0, int256(read()), 0, block.timestamp, 0);
    }

    /// @inheritdoc AggregatorV3Interface
    /// @dev This function always returns the latestRoundData
    function getRoundData(uint80) external view returns (uint80, int256, uint256, uint256, uint80) {
        return latestRoundData();
    }
}
