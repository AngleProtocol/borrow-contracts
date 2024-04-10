// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "forge-std/Script.sol";
import { console } from "forge-std/console.sol";
import { IMorpho, MarketParams } from "../../../contracts/interfaces/external/morpho/IMorpho.sol";
import { IMorphoChainlinkOracleV2Factory, IMorphoOracle } from "../../../contracts/interfaces/external/morpho/IMorphoChainlinkOracleV2.sol";
import "./MainnetConstants.s.sol";
import { StdCheats, StdAssertions } from "forge-std/Test.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// Before running this script, ensure that the deployer has the necessary balance in all tokens to seed the markets
contract CreateMorphoMarkets is Script, MainnetConstants, StdCheats, StdAssertions {
    error ZeroAdress();

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        console.log("Address: %s", deployer);
        console.log(deployer.balance);
        vm.startBroadcast(deployerPrivateKey);
        console.log(USDA);

        MarketParams memory params;
        bytes memory emptyData;

        deal(GTETHPRIME, deployer, BASE_DEPOSIT_ETH_AMOUNT);
        deal(RE7ETH, deployer, BASE_DEPOSIT_ETH_AMOUNT);
        deal(GTUSDCPRIME, deployer, BASE_DEPOSIT_USD_AMOUNT);
        deal(RE7USDT, deployer, BASE_DEPOSIT_USD_AMOUNT);

        IERC20(USDA).approve(MORPHO_BLUE, type(uint256).max);
        address oracle;
        bytes32 salt;
        string memory marketName;

        {
            /*//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                      GTETH PRIME                                                   
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////*/

            marketName = "gtETH";
            uint256 baseDepositAmount = BASE_DEPOSIT_ETH_AMOUNT;
            oracle = IMorphoChainlinkOracleV2Factory(MORPHO_ORACLE_FACTORY).createMorphoChainlinkOracleV2(
                address(GTETHPRIME),
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
            assertApproxEqRel(price, 3500 * 10 ** 36, 10 ** 35);
            params.collateralToken = GTETHPRIME;
            params.irm = IRM_MODEL;
            params.lltv = LLTV_77;
            params.oracle = oracle;
            params.loanToken = USDA;
            _logMarket(params, marketName);
            IMorpho(MORPHO_BLUE).createMarket(params);
            IMorpho(MORPHO_BLUE).supply(params, 0.5 ether, 0, deployer, emptyData);
            IERC20(params.collateralToken).approve(MORPHO_BLUE, baseDepositAmount);
            console.log(IERC20(params.collateralToken).balanceOf(deployer));
            IMorpho(MORPHO_BLUE).supplyCollateral(params, baseDepositAmount, deployer, emptyData);
            IMorpho(MORPHO_BLUE).borrow(params, (0.5 ether * 9) / 10, 0, deployer, deployer);
        }

        {
            /*//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                        RE7ETH                                                      
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////*/

            marketName = "RE7 ETH";
            uint256 baseDepositAmount = BASE_DEPOSIT_ETH_AMOUNT;
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
            assertApproxEqRel(price, 3500 * 10 ** 36, 10 ** 35);
            params.collateralToken = RE7ETH;
            params.irm = IRM_MODEL;
            params.lltv = LLTV_77;
            params.oracle = oracle;
            params.loanToken = USDA;
            _logMarket(params, marketName);
            IMorpho(MORPHO_BLUE).createMarket(params);
            IMorpho(MORPHO_BLUE).supply(params, 0.5 ether, 0, deployer, emptyData);
            IERC20(params.collateralToken).approve(MORPHO_BLUE, baseDepositAmount);
            IMorpho(MORPHO_BLUE).supplyCollateral(params, baseDepositAmount, deployer, emptyData);
            IMorpho(MORPHO_BLUE).borrow(params, (0.5 ether * 9) / 10, 0, deployer, deployer);
        }

        {
            /*//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                      GTUSDCPRIME                                                   
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////*/

            marketName = "gtUSDC";
            uint256 baseDepositAmount = BASE_DEPOSIT_USD_AMOUNT;
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
            uint256 price = IMorphoOracle(oracle).price();
            assertApproxEqRel(price, 1 * 10 ** 36, 10 ** 35);
            params.collateralToken = GTUSDCPRIME;
            params.lltv = LLTV_86;
            params.irm = IRM_MODEL;
            params.oracle = oracle;
            params.loanToken = USDA;
            _logMarket(params, marketName);
            IMorpho(MORPHO_BLUE).createMarket(params);
            IMorpho(MORPHO_BLUE).supply(params, 0.5 ether, 0, deployer, emptyData);
            IERC20(params.collateralToken).approve(MORPHO_BLUE, baseDepositAmount);
            console.log(IERC20(params.collateralToken).balanceOf(deployer));
            IMorpho(MORPHO_BLUE).supplyCollateral(params, baseDepositAmount, deployer, emptyData);
            IMorpho(MORPHO_BLUE).borrow(params, (0.5 ether * 9) / 10, 0, deployer, deployer);
        }

        {
            /*//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                        RE7USDT                                                     
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////*/

            marketName = "RE7 USDT";
            uint256 baseDepositAmount = BASE_DEPOSIT_USD_AMOUNT;
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
            assertApproxEqRel(price, 1 * 10 ** 36, 10 ** 35);
            params.collateralToken = RE7USDT;
            params.lltv = LLTV_86;
            params.irm = IRM_MODEL;
            params.oracle = oracle;
            params.loanToken = USDA;
            _logMarket(params, marketName);
            IMorpho(MORPHO_BLUE).createMarket(params);
            IMorpho(MORPHO_BLUE).supply(params, 0.5 ether, 0, deployer, emptyData);
            IERC20(params.collateralToken).approve(MORPHO_BLUE, baseDepositAmount);
            console.log(IERC20(params.collateralToken).balanceOf(deployer));
            IMorpho(MORPHO_BLUE).supplyCollateral(params, baseDepositAmount, deployer, emptyData);
            IMorpho(MORPHO_BLUE).borrow(params, (0.5 ether * 9) / 10, 0, deployer, deployer);
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
        uint256 price = IMorphoOracle(params.oracle).price();
        console.log("oracle price", price);
        console.log("formatted oracle price", price / 10 ** 36);
        console.log("");
    }
}
