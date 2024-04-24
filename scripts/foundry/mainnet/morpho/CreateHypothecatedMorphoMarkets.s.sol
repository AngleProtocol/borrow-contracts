// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "forge-std/Script.sol";
import { console } from "forge-std/console.sol";
import { IMorpho } from "../../../../contracts/interfaces/external/morpho/IMorpho.sol";
import { IMorphoChainlinkOracleV2Factory, IMorphoOracle } from "../../../../contracts/interfaces/external/morpho/IMorphoChainlinkOracleV2.sol";
import "../MainnetConstants.s.sol";
import { StdCheats, StdAssertions } from "forge-std/Test.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Id, MarketParams, MarketParamsLib } from "morpho-blue/libraries/MarketParamsLib.sol";

// Before running this script, ensure that the deployer has the necessary balance in all tokens to seed the markets
contract CreateHypothecatedMorphoMarkets is Script, MainnetConstants, StdCheats, StdAssertions {
    error ZeroAdress();

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        vm.startBroadcast(deployerPrivateKey);

        MarketParams memory params;
        bytes memory emptyData;

        // deal(PTWeETH, deployer, BASE_SUPPLY_ETH_AMOUNT);
        // deal(GTETHPRIME, deployer, BASE_SUPPLY_ETH_AMOUNT);
        // deal(RE7ETH, deployer, BASE_SUPPLY_ETH_AMOUNT);
        // deal(GTUSDCPRIME, deployer, BASE_SUPPLY_USD_AMOUNT);
        // deal(RE7USDT, deployer, BASE_SUPPLY_USD_AMOUNT);

        // IERC20(USDA).approve(MORPHO_BLUE, 10 ether);
        address oracle;
        bytes32 salt;
        string memory marketName;

        {
            /*//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                    SETUP PT WEETH                                                  
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////*/
            /*
            marketName = "PTweETH";
            uint256 baseSupplyAmount = BASE_SUPPLY_ETH_AMOUNT;
            bytes32 salt;
            address ptETHFIOracle = IMorphoChainlinkOracleV2Factory(MORPHO_ORACLE_FACTORY)
                .createMorphoChainlinkOracleV2(
                    address(0),
                    1,
                    PTEETH_WEETH_ORACLE,
                    WEETH_USD_ORACLE,
                    18,
                    address(0),
                    1,
                    address(0),
                    address(0),
                    18,
                    salt
                );
            uint256 price = IMorphoOracle(ptETHFIOracle).price();
            console.log(price);
            assertApproxEqRel(price, 3000 * 10 ** 36, 0.05 ether);
            params.collateralToken = PTWeETH;
            params.irm = IRM_MODEL;
            params.lltv = LLTV_86;
            params.oracle = ptETHFIOracle;
            params.loanToken = USDA;
            IMorpho(MORPHO_BLUE).createMarket(params);
            _logMarket(params, marketName);
            IMorpho(MORPHO_BLUE).supply(params, BASE_BORROW_USD_AMOUNT, 0, deployer, emptyData);
            IERC20(PTWeETH).approve(MORPHO_BLUE, baseSupplyAmount);
            IMorpho(MORPHO_BLUE).supplyCollateral(params, baseSupplyAmount, deployer, emptyData);
            IMorpho(MORPHO_BLUE).borrow(params, BASE_BORROW_USD_AMOUNT, 0, deployer, deployer);
            */
        }

        {
            /*//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                          GTETH PRIME
            //////////////////////////////////////////////////////////////////////////////////////////////////////////////////*/
            /*
            marketName = "gtETH";
            uint256 baseSupplyAmount = BASE_SUPPLY_ETH_AMOUNT;
            // oracle = IMorphoChainlinkOracleV2Factory(MORPHO_ORACLE_FACTORY).createMorphoChainlinkOracleV2(
            //     address(GTETHPRIME),
            //     1 ether,
            //     CHAINLINK_ETH_USD_ORACLE,
            //     address(0),
            //     18,
            //     address(0),
            //     1,
            //     address(0),
            //     address(0),
            //     18,
            //     salt
            // );
            oracle = 0xe4CCAA1849e9058f77f555C0FCcA4925Efd37d8E;
            uint256 price = IMorphoOracle(oracle).price();
            console.log(price);
            assertApproxEqRel(price, 3100 * 10 ** 36, 0.02 ether);
            params.collateralToken = GTETHPRIME;
            params.irm = IRM_MODEL;
            params.lltv = LLTV_77;
            params.oracle = oracle;
            params.loanToken = USDA;
            _logMarket(params, marketName);
            IMorpho(MORPHO_BLUE).createMarket(params);
            IMorpho(MORPHO_BLUE).supply(params, BASE_BORROW_USD_AMOUNT, 0, deployer, emptyData);
            IERC20(params.collateralToken).approve(MORPHO_BLUE, baseSupplyAmount);
            IMorpho(MORPHO_BLUE).supplyCollateral(params, baseSupplyAmount, deployer, emptyData);
            IMorpho(MORPHO_BLUE).borrow(params, BASE_BORROW_USD_AMOUNT, 0, deployer, deployer);
            */
        }

        {
            /*//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                            RE7ETH
        //////////////////////////////////////////////////////////////////////////////////////////////////////////////////*/
            /*
            marketName = "RE7 ETH";
            uint256 baseSupplyAmount = BASE_SUPPLY_ETH_AMOUNT;
            oracle = IMorphoChainlinkOracleV2Factory(MORPHO_ORACLE_FACTORY).createMorphoChainlinkOracleV2(
                address(RE7ETH),
                1 ether,
                CHAINLINK_ETH_USD_ORACLE,
                address(0),
                18,
                address(0),
                1,
                address(0),
                address(0),
                18,
                salt
            );
            uint256 price = IMorphoOracle(oracle).price();
            console.log(price);
            assertApproxEqRel(price, 3170 * 10 ** 36, 0.02 ether);
            params.collateralToken = RE7ETH;
            params.irm = IRM_MODEL;
            params.lltv = LLTV_86;
            params.oracle = oracle;
            params.loanToken = USDA;
            _logMarket(params, marketName);
            IMorpho(MORPHO_BLUE).createMarket(params);
            IMorpho(MORPHO_BLUE).supply(params, BASE_BORROW_USD_AMOUNT, 0, deployer, emptyData);
            IERC20(params.collateralToken).approve(MORPHO_BLUE, baseSupplyAmount);
            IMorpho(MORPHO_BLUE).supplyCollateral(params, baseSupplyAmount, deployer, emptyData);
            IMorpho(MORPHO_BLUE).borrow(params, BASE_BORROW_USD_AMOUNT, 0, deployer, deployer);
            */
        }

        {
            /*//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                          GTUSDCPRIME
        //////////////////////////////////////////////////////////////////////////////////////////////////////////////////*/
            /*
            marketName = "gtUSDC";
            uint256 baseSupplyAmount = BASE_SUPPLY_USD_AMOUNT;
            oracle = IMorphoChainlinkOracleV2Factory(MORPHO_ORACLE_FACTORY).createMorphoChainlinkOracleV2(
                address(GTUSDCPRIME),
                1 ether,
                CHAINLINK_USDC_USD_ORACLE,
                address(0),
                6,
                address(0),
                1,
                address(0),
                address(0),
                18,
                salt
            );
            oracle = 0x3B8c4A340336941524DE276FF730b3Be71157B55;
            uint256 price = IMorphoOracle(oracle).price();
            console.log(price);
            assertApproxEqRel(price, 1 * 10 ** 36, 0.01 ether);
            params.collateralToken = GTUSDCPRIME;
            params.lltv = LLTV_86;
            params.irm = IRM_MODEL;
            params.oracle = oracle;
            params.loanToken = USDA;
            _logMarket(params, marketName);
            IMorpho(MORPHO_BLUE).createMarket(params);
            IERC20(params.loanToken).approve(MORPHO_BLUE, BASE_BORROW_USD_AMOUNT);
            IMorpho(MORPHO_BLUE).supply(params, BASE_BORROW_USD_AMOUNT, 0, deployer, emptyData);
            IERC20(params.collateralToken).approve(MORPHO_BLUE, baseSupplyAmount);
            IMorpho(MORPHO_BLUE).supplyCollateral(params, baseSupplyAmount, deployer, emptyData);
            IMorpho(MORPHO_BLUE).borrow(params, BASE_BORROW_USD_AMOUNT, 0, deployer, deployer);
            */
        }

        {
            /*//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                            RE7USDT
            //////////////////////////////////////////////////////////////////////////////////////////////////////////////////*/
            /*
            marketName = "RE7 USDT";
            uint256 baseSupplyAmount = BASE_SUPPLY_USD_AMOUNT;
            oracle = IMorphoChainlinkOracleV2Factory(MORPHO_ORACLE_FACTORY).createMorphoChainlinkOracleV2(
                address(RE7USDT),
                1 ether,
                CHAINLINK_USDT_USD_ORACLE,
                address(0),
                6,
                address(0),
                1,
                address(0),
                address(0),
                18,
                salt
            );
            uint256 price = IMorphoOracle(oracle).price();
            assertApproxEqRel(price, 1 * 10 ** 36, 0.03 ether);
            params.collateralToken = RE7USDT;
            params.lltv = LLTV_91;
            params.irm = IRM_MODEL;
            params.oracle = oracle;
            params.loanToken = USDA;
            _logMarket(params, marketName);
            IMorpho(MORPHO_BLUE).createMarket(params);
            IERC20(params.loanToken).approve(MORPHO_BLUE, BASE_BORROW_USD_AMOUNT);
            IMorpho(MORPHO_BLUE).supply(params, BASE_BORROW_USD_AMOUNT, 0, deployer, emptyData);
            IERC20(params.collateralToken).approve(MORPHO_BLUE, baseSupplyAmount);
            IMorpho(MORPHO_BLUE).supplyCollateral(params, baseSupplyAmount, deployer, emptyData);
            IMorpho(MORPHO_BLUE).borrow(params, BASE_BORROW_USD_AMOUNT, 0, deployer, deployer);
            */
        }

        {
            /*//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                     STEUR - EURE                                                   
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////*/

            marketName = "stEUR EURe";
            uint256 baseSupplyAmount = BASE_SUPPLY_USD_AMOUNT;
            oracle = IMorphoChainlinkOracleV2Factory(MORPHO_ORACLE_FACTORY).createMorphoChainlinkOracleV2(
                address(STEUR),
                1 ether,
                CHAINLINK_EURA_EUR_ORACLE,
                address(0),
                18,
                address(0),
                1,
                address(0),
                address(0),
                18,
                salt
            );
            uint256 price = IMorphoOracle(oracle).price();
            assertApproxEqRel(price, 1 * 10 ** 36, 0.03 ether);
            params.collateralToken = STEUR;
            params.lltv = LLTV_94;
            params.irm = IRM_MODEL;
            params.oracle = oracle;
            params.loanToken = EURE;
            _logMarket(params, marketName);
            IMorpho(MORPHO_BLUE).createMarket(params);
            IERC20(params.loanToken).approve(MORPHO_BLUE, BASE_BORROW_USD_AMOUNT);
            IERC20(params.collateralToken).approve(MORPHO_BLUE, baseSupplyAmount);
            IMorpho(MORPHO_BLUE).supply(params, BASE_BORROW_USD_AMOUNT, 0, deployer, emptyData);
            IMorpho(MORPHO_BLUE).supplyCollateral(params, baseSupplyAmount, deployer, emptyData);
            IMorpho(MORPHO_BLUE).borrow(params, (BASE_BORROW_USD_AMOUNT * 99) / 100, 0, deployer, deployer);
        }

        vm.stopBroadcast();
    }

    function _logMarket(MarketParams memory params, string memory marketName) internal view {
        console.log("");
        console.log(marketName);
        console.log("collateral", params.collateralToken);
        console.log("irm", params.irm);
        console.log("lltv", params.lltv);
        console.log("oracle", params.oracle);
        console.log("loan token", params.loanToken);
        console.log("oracle price", IMorphoOracle(params.oracle).price());
        console.log("");
    }
}
