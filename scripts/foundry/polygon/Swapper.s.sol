// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "forge-std/Script.sol";
import { console } from "forge-std/console.sol";
import "../../../contracts/interfaces/IOracle.sol";
import "../../../contracts/interfaces/IAngleRouterSidechain.sol";
import "../../../contracts/interfaces/external/uniswap/IUniswapRouter.sol";
import { CurveLevSwapperTricrypto3 } from "../../../contracts/swapper/LevSwapper/curve/implementations/polygon/CurveLevSwapperTricrypto3.sol";
import "./PolygonConstants.s.sol";

contract DeploySwapper is Script, PolygonConstants {
    function run() external {
        uint256 deployerPrivateKey = vm.deriveKey(vm.envString("MNEMONIC_POLYGON"), 0);
        vm.startBroadcast(deployerPrivateKey);

        CurveLevSwapperTricrypto3 swapper = new CurveLevSwapperTricrypto3(
            ICoreBorrow(CORE_BORROW),
            IUniswapV3Router(UNI_V3_ROUTER),
            ONE_INCH,
            IAngleRouterSidechain(ANGLE_ROUTER)
        );

        console.log("Successfully deployed swapper tricrypto at the address: ", address(swapper));

        vm.stopBroadcast();
    }
}
