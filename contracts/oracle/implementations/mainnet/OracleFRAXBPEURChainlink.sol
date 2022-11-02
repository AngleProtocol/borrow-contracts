// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

import "../../BaseOracleChainlinkMulti.sol";
import "../../../interfaces/external/curve/ICurveCryptoSwapPool.sol";

/// @title OracleFRAXBPEURChainlink
/// @author Angle Core Team
/// @notice Gives a lower bound of the price of Curve FRAXBP in Euro in base 18
contract OracleFRAXBPEURChainlink is BaseOracleChainlinkMulti {
    string public constant DESCRIPTION = "FRAXBP/EUR Oracle";
    ICurveCryptoSwapPool public constant FRAXBP = ICurveCryptoSwapPool(0xDcEF968d416a41Cdac0ED8702fAC8128A64241A2);

    /// @notice Constructor of the contract
    /// @param _stalePeriod Minimum feed update frequency for the oracle to not revert
    /// @param _treasury Treasury associated to the `VaultManager` which reads from this feed
    constructor(uint32 _stalePeriod, address _treasury) BaseOracleChainlinkMulti(_stalePeriod, _treasury) {}

    /// @inheritdoc IOracle
    function read() external view override returns (uint256 quoteAmount) {
        // We use 0 decimals when reading fees through `readChainlinkFeed` since all feeds have 8 decimals
        // and the virtual price of the Curve pool is given in 18 decimals, just like the amount of decimals
        // of the FRAXBP token
        uint256 fraxPrice = _readChainlinkFeed(
            1,
            AggregatorV3Interface(0xB9E1E3A9feFf48998E45Fa90847ed4D467E8BcfD),
            1,
            0
        );
        uint256 usdcPrice = _readChainlinkFeed(
            1,
            AggregatorV3Interface(0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6),
            1,
            0
        );
        // Picking the minimum price between FRAX and USDC, multiplying it by the pool's virtual price
        usdcPrice = usdcPrice >= fraxPrice ? fraxPrice : usdcPrice;
        quoteAmount = _readChainlinkFeed(
            (FRAXBP.get_virtual_price() * usdcPrice),
            AggregatorV3Interface(0xb49f677943BC038e9857d61E7d053CaA2C1734C1),
            0,
            0
        );
    }
}
