// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.17;

import "forge-std/Script.sol";
import { console } from "forge-std/console.sol";
import { IMorpho, MarketParams } from "../../../../contracts/interfaces/external/morpho/IMorpho.sol";
import { IMorphoOracle } from "../../../../contracts/interfaces/external/morpho/IMorphoChainlinkOracleV2.sol";
import { IMorphoChainlinkOracleV2Factory } from "borrow-contracts/interfaces/external/morpho/IMorphoChainlinkOracleV2Factory.sol";
import { MorphoFeedPTUSDe } from "borrow-contracts/oracle/morpho/mainnet/MorphoFeedPTUSDe.sol";
import { MainnetConstants } from "./MainnetConstants.s.sol";
import "../../../lib/utils/src/Constants.sol";
import { IAccessControlManager } from "borrow-contracts/interfaces/IAccessControlManager.sol";
import { StdCheats, StdAssertions } from "forge-std/Test.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { IERC4626 } from "borrow-contracts/interfaces/external/IERC4626.sol";

contract PTUSDeOracleDeploy is MainnetConstants, Script, StdCheats, StdAssertions {
    MarketParams public params;
    bytes public emptyData;
    uint256 constant BASE_DEPOSIT_AMOUNT = 10 ether;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        vm.startBroadcast(deployerPrivateKey);

        // TODO
        uint256 chainId = CHAIN_ETHEREUM;
        address coreBorrow = 0x5bc6BEf80DA563EBf6Df6D6913513fa9A7ec89BE;
        uint32 _TWAP_DURATION = 30 minutes;
        uint256 _MAX_IMPLIED_RATE = 0.5 ether;
        // end TODO

        MorphoFeedPTUSDe priceFeed = new MorphoFeedPTUSDe(
            IAccessControlManager(address(coreBorrow)),
            _MAX_IMPLIED_RATE,
            _TWAP_DURATION
        );
        (, int256 answer, , , ) = priceFeed.latestRoundData();
        console.log("oracle value ", uint256(answer));
        console.log("Successfully deployed PT-weETH: ", address(priceFeed));

        MarketParams memory params;
        bytes memory emptyData;

        params.collateralToken = PTUSDe;
        params.lltv = LLTV_86;
        params.irm = IRM_MODEL;
        params.loanToken = USDA;

        // PT USDe market
        params.oracle = address(
            IMorphoChainlinkOracleV2Factory(MORPHO_ORACLE_FACTORY).createMorphoChainlinkOracleV2(
                IERC4626(address(0)),
                1,
                AggregatorV3Interface(address(priceFeed)),
                AggregatorV3Interface(USDE_USD_ORACLE),
                IERC20Metadata(PTUSDe).decimals(),
                IERC4626(address(0)),
                1,
                AggregatorV3Interface(address(0)),
                AggregatorV3Interface(address(0)),
                IERC20Metadata(params.loanToken).decimals(),
                hex""
            )
        );

        {
            uint256 price = IMorphoOracle(params.oracle).price();
            assertApproxEqRel(price, 0.9 ether * 1 ether, 0.01 ether);
        }

        IMorpho(MORPHO_BLUE).createMarket(params);

        IERC20(USDA).approve(MORPHO_BLUE, 20 ether);
        IMorpho(MORPHO_BLUE).supply(params, 1 ether, 0, deployer, emptyData);
        IERC20(params.collateralToken).approve(MORPHO_BLUE, BASE_DEPOSIT_AMOUNT);
        IMorpho(MORPHO_BLUE).supplyCollateral(params, BASE_DEPOSIT_AMOUNT, deployer, emptyData);
        IMorpho(MORPHO_BLUE).borrow(params, 1 ether, 0, deployer, deployer);

        vm.stopBroadcast();
    }
}
