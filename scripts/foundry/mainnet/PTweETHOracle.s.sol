// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.17;

import "forge-std/Script.sol";
import { console } from "forge-std/console.sol";
import { MorphoFeedPTweETHDec24 } from "borrow-contracts/oracle/morpho/mainnet/MorphoFeedPTweETHDec24.sol";
import "utils/src/CommonUtils.sol";
import { IAccessControlManager } from "borrow-contracts/interfaces/IAccessControlManager.sol";

contract PTweETHOracleDeploy is Script, CommonUtils {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        vm.startBroadcast(deployerPrivateKey);

        // TODO
        uint256 chainId = CHAIN_ETHEREUM;
        address coreBorrow = _chainToContract(chainId, ContractType.CoreBorrow);
        uint32 _TWAP_DURATION = 30 minutes;
        uint256 _MAX_IMPLIED_RATE = 0.4 ether;
        // end TODO

        MorphoFeedPTweETHDec24 oracle = new MorphoFeedPTweETHDec24(
            IAccessControlManager(address(coreBorrow)),
            _MAX_IMPLIED_RATE,
            _TWAP_DURATION
        );
        (, int256 answer, , , ) = oracle.latestRoundData();
        console.log("oracle value ", uint256(answer));
        console.log("Successfully deployed PT-weETH: ", address(oracle));

        vm.stopBroadcast();
    }
}
