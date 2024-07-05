// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "forge-std/Script.sol";
import { console } from "forge-std/console.sol";
import { IMorpho, MarketParams } from "../../../../contracts/interfaces/external/morpho/IMorpho.sol";
import { IMorphoChainlinkOracleV2Factory, IMorphoOracle } from "../../../../contracts/interfaces/external/morpho/IMorphoChainlinkOracleV2.sol";
import "../MainnetConstants.s.sol";
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
        // vm.startPrank(deployer);
        console.log(EURA);
        console.log(IERC20(EURA).balanceOf(deployer));

        MarketParams memory params;
        bytes memory emptyData;

        IERC20(EURA).approve(MORPHO_BLUE, type(uint256).max);

        /*//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                      SETUP WSTETH                                                   
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////*/

        {
            bytes32 salt;
            address wstETHOracle = 0x44D6d497fb53294f283983E2931972840eb3DD90;
            uint256 price = IMorphoOracle(wstETHOracle).price();
            console.log(price);
            assertApproxEqRel(price, 3500 * 10 ** 36, 10 ** 35);
            params.collateralToken = WSTETH;
            params.irm = IRM_MODEL;
            params.lltv = LLTV_86;
            params.oracle = wstETHOracle;
            params.loanToken = EURA;
            console.log("wstETH Market");
            _logMarket(params);
            IMorpho(MORPHO_BLUE).createMarket(params);
            IMorpho(MORPHO_BLUE).supply(params, 1 ether / 2, 0, deployer, emptyData);
            // 0.0009 wstETH
            IERC20(WSTETH).approve(MORPHO_BLUE, 9 * 10 ** 14);
            IMorpho(MORPHO_BLUE).supplyCollateral(params, 9 * 10 ** 14, deployer, emptyData);
            IMorpho(MORPHO_BLUE).borrow(params, (1 ether * 9) / 20, 0, deployer, deployer);
        }

        /*//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                      SETUP WBTC                                                   
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////*/

        {
            bytes32 salt;
            /*
            address wBTCOracle = IMorphoChainlinkOracleV2Factory(MORPHO_ORACLE_FACTORY).createMorphoChainlinkOracleV2(
                address(0),
                1,
                CHAINLINK_WBTC_BTC_ORACLE,
                CHAINLINK_BTC_USD_ORACLE,
                8,
                address(0),
                1,
                CHAINLINK_EUR_USD_ORACLE,
                address(0),
                18,
                salt
            );
            */
            address wBTCOracle = 0xD122315BD4E89386045F51f6e65A6EeDb0dD31b9;

            uint256 price = IMorphoOracle(wBTCOracle).price();
            console.log(price);
            assertApproxEqRel(price, 3500 * 10 ** 36, 10 ** 35);
            params.collateralToken = WBTC;
            params.irm = IRM_MODEL;
            params.lltv = LLTV_86;
            params.oracle = wBTCOracle;
            params.loanToken = EURA;
            console.log("wBTC Market");
            _logMarket(params);
            IMorpho(MORPHO_BLUE).createMarket(params);
            IMorpho(MORPHO_BLUE).supply(params, 1 ether / 2, 0, deployer, emptyData);
            IERC20(WBTC).approve(MORPHO_BLUE, 1 * 10 ** 4);
            IMorpho(MORPHO_BLUE).supplyCollateral(params, 1 * 10 ** 4, deployer, emptyData);
            IMorpho(MORPHO_BLUE).borrow(params, (1 ether * 9) / 20, 0, deployer, deployer);
        }

        /*//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                      IDLE MARKET                                                   
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////*/

        {
            params.collateralToken = address(0);
            params.irm = address(0);
            params.lltv = 0;
            params.oracle = address(0);
            params.loanToken = EURA;
            console.log("Idle Market");
            _logMarket(params);
            IMorpho(MORPHO_BLUE).createMarket(params);
        }
        vm.stopBroadcast();
    }

    function _logMarket(MarketParams memory params) internal view {
        console.log("");
        console.log("collateral", params.collateralToken);
        console.log("irm", params.irm);
        console.log("lltv", params.lltv);
        console.log("oracle", params.oracle);
        console.log("loan token", params.loanToken);
        console.log("");
    }
}
