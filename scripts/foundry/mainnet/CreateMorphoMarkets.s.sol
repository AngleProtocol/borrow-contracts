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

    address public USDA;

    function setUp() {
        USDA = _chainToContract(1, ContractType.AgUSD);
    }

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        console.log("Address: %s", deployer);
        console.log(deployer.balance);
        vm.startBroadcast(deployerPrivateKey);
        console.log(USDA);

        MarketParams memory params;
        bytes memory emptyData;

        /*
        deal(EZETH, deployer, 10 ** 16);
        deal(RSETH, deployer, 10 ** 16);
        deal(PTWeETH, deployer, 10 ** 16);
        deal(USDA, deployer, 3 ether);
        */

        IERC20(USDA).approve(MORPHO_BLUE, type(uint256).max);

        /*//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                      SETUP EZETH                                                   
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////*/
        {
            bytes32 salt;
            address ezETHOracle = IMorphoChainlinkOracleV2Factory(MORPHO_ORACLE_FACTORY).createMorphoChainlinkOracleV2(
                address(0),
                1,
                EZETH_ETH_ORACLE,
                CHAINLINK_ETH_USD_ORACLE,
                18,
                address(0),
                1,
                address(0),
                address(0),
                18,
                salt
            );
            uint256 price = IMorphoOracle(ezETHOracle).price();
            console.log(price);
            assertApproxEqRel(price, 3500 * 10 ** 36, 10 ** 35);
            params.collateralToken = EZETH;
            params.irm = IRM_MODEL;
            params.lltv = LLTV_77;
            params.oracle = ezETHOracle;
            params.loanToken = USDA;
            IMorpho(MORPHO_BLUE).createMarket(params);
            IMorpho(MORPHO_BLUE).supply(params, 1 ether, 0, deployer, emptyData);
            // 0.009 ezETH
            IERC20(EZETH).approve(MORPHO_BLUE, 9 * 10 ** 15);
            IMorpho(MORPHO_BLUE).supplyCollateral(params, 9 * 10 ** 15, deployer, emptyData);
            IMorpho(MORPHO_BLUE).borrow(params, (1 ether * 9) / 10, 0, deployer, deployer);
        }

        /*//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                      SETUP RSETH                                                   
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////*/

        {
            bytes32 salt;
            address rsETHOracle = IMorphoChainlinkOracleV2Factory(MORPHO_ORACLE_FACTORY).createMorphoChainlinkOracleV2(
                address(0),
                1,
                RSETH_ETH_ORACLE,
                CHAINLINK_ETH_USD_ORACLE,
                18,
                address(0),
                1,
                address(0),
                address(0),
                18,
                salt
            );

            uint256 price = IMorphoOracle(rsETHOracle).price();
            console.log(price);
            assertApproxEqRel(price, 3500 * 10 ** 36, 10 ** 35);
            params.collateralToken = RSETH;
            params.irm = IRM_MODEL;
            params.lltv = LLTV_77;
            params.oracle = rsETHOracle;
            params.loanToken = USDA;
            IMorpho(MORPHO_BLUE).createMarket(params);
            IMorpho(MORPHO_BLUE).supply(params, 1 ether, 0, deployer, emptyData);
            IERC20(RSETH).approve(MORPHO_BLUE, 9 * 10 ** 15);
            IMorpho(MORPHO_BLUE).supplyCollateral(params, 9 * 10 ** 15, deployer, emptyData);
            IMorpho(MORPHO_BLUE).borrow(params, (1 ether * 9) / 10, 0, deployer, deployer);
        }

        /*//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                    SETUP PT WEETH                                                  
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////*/
        /*
        {
            bytes32 salt;
            address ptETHFIOracle = IMorphoChainlinkOracleV2Factory(MORPHO_ORACLE_FACTORY)
                .createMorphoChainlinkOracleV2(
                    address(0),
                    1,
                    // TODO: make sure it's been updated
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
            assertApproxEqRel(price, 3500 * 10 ** 18, 10 ** 17);
            params.collateralToken = PTWeETH;
            params.irm = IRM_MODEL;
            params.lltv = LLTV_62;
            params.oracle = ptETHFIOracle;
            params.loanToken = USDA;
            IMorpho(MORPHO_BLUE).createMarket(params);
            IMorpho(MORPHO_BLUE).supply(params, 1 ether, 0, deployer, emptyData);
            IERC20(PTWeETH).approve(MORPHO_BLUE, 10 ** 16);
            IMorpho(MORPHO_BLUE).supplyCollateral(params, 10 ** 16, deployer, emptyData);
            IMorpho(MORPHO_BLUE).borrow(params, (1 ether * 9) / 10, 0, deployer, deployer);
        }
        */

        vm.stopBroadcast();
    }
}
