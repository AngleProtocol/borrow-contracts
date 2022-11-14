// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

import "../../BaseOracleChainlinkMulti.sol";
import "../../../interfaces/external/curve/ICurveCryptoSwapPool.sol";

/// @title OracleAaveUSDBP_EUR
/// @author Angle Labs, Inc
/// @notice Gives the price of Curve USD Aave BP in Euro in base 18
contract OracleAaveUSDBPEUR is BaseOracleChainlinkMulti {
    string public constant DESCRIPTION = "am3CRV/EUR Oracle";
    ICurveCryptoSwapPool public constant AaveUSDBP = ICurveCryptoSwapPool(0x445FE580eF8d70FF569aB36e80c647af338db351);

    /// @notice Constructor of the contract
    /// @param _stalePeriod Minimum feed update frequency for the oracle to not revert
    /// @param _treasury Treasury associated to the `VaultManager` which reads from this feed
    constructor(uint32 _stalePeriod, address _treasury) BaseOracleChainlinkMulti(_stalePeriod, _treasury) {}

    function circuitChainlink() public pure returns (AggregatorV3Interface[4] memory) {
        // as it is a collateral test we consider that 1 amXXX = 1 XXX, but there can be liquidity issue
        // in which case this may not hold anymore
        return [
            // Chainlink DAI/USD address
            AggregatorV3Interface(0x4746DeC9e833A82EC7C2C1356372CcF2cfcD2F3D),
            // Chainlink USDC/USD address
            AggregatorV3Interface(0xfE4A8cc5b5B2366C1B58Bea3858e81843581b2F7),
            // Chainlink USDT/USD address
            AggregatorV3Interface(0x0A6513e40db6EB1b165753AD52E80663aeA50545),
            // Chainlink EUR/USD address
            AggregatorV3Interface(0x73366Fe0AA0Ded304479862808e02506FE556a98)
        ];
    }

    /// @inheritdoc IOracle
    function read() external view override returns (uint256 quoteAmount) {
        AggregatorV3Interface[4] memory _circuitChainlink = circuitChainlink();
        quoteAmount = _readChainlinkFeed(_lpPriceBase(), _circuitChainlink[3], 0, 8);
    }

    /// @notice Get the underlying LP token price
    function _lpPriceBase() internal view returns (uint256) {
        AggregatorV3Interface[4] memory _circuitChainlink = circuitChainlink();

        uint256 daiPrice = _readChainlinkFeed(1, _circuitChainlink[0], 1, 0);
        uint256 usdcPrice = _readChainlinkFeed(1, _circuitChainlink[1], 1, 0);
        uint256 usdtPrice = _readChainlinkFeed(1, _circuitChainlink[2], 1, 0);
        // Picking the minimum price between DAI, USDC and USDT, multiplying it by the pool's virtual price
        // All oracles are in base 8
        usdcPrice = usdcPrice >= daiPrice ? (daiPrice >= usdtPrice ? usdtPrice : daiPrice) : usdcPrice >= usdtPrice
            ? usdtPrice
            : usdcPrice;

        return (AaveUSDBP.get_virtual_price() * usdcPrice) / 10**8;
    }
}
