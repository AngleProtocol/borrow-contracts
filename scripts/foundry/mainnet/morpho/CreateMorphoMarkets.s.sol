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
        //vm.startPrank(deployer);
        console.log(USDT);
        console.log(IERC20(USDT).balanceOf(deployer));

        MarketParams memory params;
        bytes memory emptyData;

        // IERC20(USDT).approve(MORPHO_BLUE, type(uint256).max);

        /*//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                      SETUP WBTC                                                   
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////*/

        {
            bytes32 salt;

            address uSDTOracle = IMorphoChainlinkOracleV2Factory(MORPHO_ORACLE_FACTORY).createMorphoChainlinkOracleV2(
                STUSD,
                1 ether,
                address(0),
                address(0),
                18,
                address(0),
                1,
                CHAINLINK_USDT_USD_ORACLE,
                address(0),
                6,
                salt
            );

            uint256 price = IMorphoOracle(uSDTOracle).price();
            assertApproxEqRel(price, 104 * 10 ** 34, 10 ** 34);
            params.collateralToken = STUSD;
            params.irm = IRM_MODEL;
            params.lltv = LLTV_94;
            params.oracle = uSDTOracle;
            params.loanToken = USDT;
            console.log("USDT Market");
            _logMarket(params);
            IMorpho(MORPHO_BLUE).createMarket(params);
            IERC20(STUSD).approve(MORPHO_BLUE, 1 * 10 ** 18);
            IMorpho(MORPHO_BLUE).supplyCollateral(params, 1 * 10 ** 18, deployer, emptyData);
            //IMorpho(MORPHO_BLUE).supply(params, 1 ether / 2, 0, deployer, emptyData);
            // IMorpho(MORPHO_BLUE).borrow(params, (1 ether * 9) / 20, 0, deployer, deployer);
        }

        vm.stopBroadcast();
        //vm.stopPrank();
    }

    function _logMarket(MarketParams memory params) internal view {
        console.log("");
        console.log("collateral", params.collateralToken);
        console.log("irm", params.irm);
        console.log("lltv", params.lltv);
        console.log("oracle", params.oracle);
        console.log("loan token", params.loanToken);
        console.log("price", IMorphoOracle(params.oracle).price());
        console.log("");
    }
}
