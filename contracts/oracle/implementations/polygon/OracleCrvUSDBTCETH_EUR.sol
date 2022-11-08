// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

import "../../BaseOracleChainlinkMulti.sol";
import "../../../interfaces/external/curve/ITricryptoPool.sol";
import "../../../interfaces/external/curve/ICurveCryptoSwapPool.sol";

/// @title OracleCrvUSDBTCETH_EUR
/// @author Angle Core Team
/// @notice Gives the price of Curve TriCrypto2 in Euro in base 18
contract OracleCrvUSDBTCETHEUR is BaseOracleChainlinkMulti {
    string public constant DESCRIPTION = "crvUSDBTCETH/EUR Oracle";
    ITricryptoPool public constant TRI_CRYPTO_POOL = ITricryptoPool(0x92215849c439E1f8612b6646060B4E3E5ef822cC);
    ICurveCryptoSwapPool public constant AaveBP = ICurveCryptoSwapPool(0x445FE580eF8d70FF569aB36e80c647af338db351);
    uint256 public constant GAMMA0 = 28000000000000; // 2.8e-5
    uint256 public constant A0 = 2 * 3**3 * 10000;
    uint256 public constant DISCOUNT0 = 1087460000000000; // 0.00108..

    error DidNotConverge();

    /// @notice Constructor of the contract
    /// @param _stalePeriod Minimum feed update frequency for the oracle to not revert
    /// @param _treasury Treasury associated to the `VaultManager` which reads from this feed
    constructor(uint32 _stalePeriod, address _treasury) BaseOracleChainlinkMulti(_stalePeriod, _treasury) {}

    function circuitChainlink() public pure returns (AggregatorV3Interface[4] memory) {
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
        quoteAmount = _readChainlinkFeed(_lpPrice(), _circuitChainlink[3], 0, 8);
    }

    /// @notice Get the global LP token price
    function _lpPrice() internal view returns (uint256) {
        uint256 lpAaveBPPrice = _lpPriceBase();
        uint256 lpMetaPrice = _lpPriceMeta();
        return (lpMetaPrice * lpAaveBPPrice) / 10**18;
    }

    /// @notice Get the meta LP token price
    function _lpPriceMeta() internal view returns (uint256 maxPrice) {
        uint256 virtualPrice = TRI_CRYPTO_POOL.virtual_price();
        uint256 priceBTC = TRI_CRYPTO_POOL.price_oracle(0);
        uint256 priceETH = TRI_CRYPTO_POOL.price_oracle(1);

        maxPrice = (3 * virtualPrice * _cubicRoot(priceBTC * priceETH)) / 10**18;

        // ((A/A0) * (gamma/gamma0)**2) ** (1/3)
        uint256 gamma = (TRI_CRYPTO_POOL.gamma() * 10**18) / GAMMA0;
        uint256 a = (TRI_CRYPTO_POOL.A() * 10**18) / A0;
        uint256 discount = (gamma**2 / 10**18) * a > 10**34 ? (gamma**2 / 10**18) * a : 10**34; // handle qbrt nonconvergence
        // if discount is small, we take an upper bound
        discount = (_cubicRoot(discount) * DISCOUNT0) / 10**18;

        maxPrice -= (maxPrice * discount) / 10**18;
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

        return (AaveBP.get_virtual_price() * usdcPrice) / 10**8;
    }

    /// @notice Get the global LP token price
    function _cubicRoot(uint256 x) internal pure returns (uint256) {
        // x is taken at base 1e36
        // result is at base 1e18
        // Will have convergence problems when ETH*BTC is cheaper than 0.01 squared dollar
        // (for example, when BTC < $0.1 and ETH < $0.1)
        uint256 D = x / 10**18;
        for (uint256 i; i < 255; i++) {
            uint256 diff;
            uint256 DPrev = D;
            D = (D * (2 * 10**18 + ((((x / D) * 10**18) / D) * 10**18) / D)) / (3 * 10**18);
            diff = D > DPrev ? D - DPrev : DPrev - D;
            if (diff <= 1 || diff * 10**18 < D) return D;
        }
        revert DidNotConverge();
    }
}
