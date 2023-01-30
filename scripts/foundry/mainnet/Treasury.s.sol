// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.17;

import "forge-std/Script.sol";
import { console } from "forge-std/console.sol";
import { ICoreBorrow } from "../../../contracts/coreBorrow/CoreBorrow.sol";
import { TreasuryImmutable } from "../../../contracts/treasury/TreasuryImmutable.sol";
import { IAgToken, AgTokenSideChainImmutable } from "../../../contracts/agToken/agTokenSidechainImmutable.sol";
import { VaultManagerLiquidationBoostImmutable, VaultParameters, VaultManagerStorage } from "../../../contracts/vaultManager/VaultManagerLiquidationBoostImmutable.sol";
import "./MainnetConstants.s.sol";

contract DeployTreasury is Script, MainnetConstants {
    string constant _NAME = "agGOLD";
    string constant _SYMBOL = "agGOLD";

    function run() external {
        uint256 deployerPrivateKey = vm.deriveKey(vm.envString("MNEMONIC_MAINNET"), 0);
        vm.rememberKey(deployerPrivateKey);

        vm.startBroadcast(deployerPrivateKey);

        TreasuryImmutable treasury = new TreasuryImmutable(ICoreBorrow(CORE_BORROW));
        console.log("Successfully deployed agGOLD treasury at the address: ", address(treasury));

        AgTokenSideChainImmutable agGOLD = new AgTokenSideChainImmutable(_NAME, _SYMBOL, address(treasury));
        console.log("Successfully deployed agGOLD  at the address: ", address(agGOLD));

        // TODO governance should call
        // treasury.setStablecoin(agGOLD);

        vm.stopBroadcast();
    }
}
