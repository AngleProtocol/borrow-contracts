// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.12;

import "@openzeppelin/contracts-upgradeable/interfaces/IERC20MetadataUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import "../BaseTest.test.sol";
import "../../../contracts/mock/MockTokenPermit.sol";
import { OracleCrvUSDBTCETHEUR, IOracle } from "../../../contracts/oracle/implementations/polygon/OracleCrvUSDBTCETH_EUR.sol";

contract OracleCrvUSDBTCETHEURTest is BaseTest {
    using stdStorage for StdStorage;
    using SafeERC20 for IERC20;

    IOracle public oracle;

    function setUp() public override {
        super.setUp();

        _polygon = vm.createFork(vm.envString("ETH_NODE_URI_POLYGON"), 15824909);
        vm.selectFork(_polygon);

        oracle = new OracleCrvUSDBTCETHEUR(3600, treasury);
    }

    // ================================== NO FORK ==================================
}
