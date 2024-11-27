// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "forge-std/Script.sol";
import { FlashAngle } from "../../../../contracts/flashloan/FlashAngle.sol";
import "lib/utils/src/CommonUtils.sol";

contract FlashAngleScript is Script, CommonUtils {
    function run() external {
        uint256 chainId = CHAIN_BASE;

        uint256 deployerPrivateKey = vm.deriveKey(vm.envString("MNEMONIC_MAINNET"), 0);
        vm.startBroadcast(deployerPrivateKey);

        FlashAngle flashloanImpl = new FlashAngle();
        console.log("FlashAngle implementation address: ", address(flashloanImpl));

        address proxyAdmin = _chainToContract(chainId, ContractType.ProxyAdmin);
        address coreBorrow = _chainToContract(chainId, ContractType.CoreBorrow);

        console.log("ProxyAdmin address: ", proxyAdmin);
        console.log("CoreBorrow address: ", coreBorrow);

        bytes memory data = abi.encodeWithSelector(FlashAngle.initialize.selector, coreBorrow);
        address proxy = address(new TransparentUpgradeableProxy(address(flashloanImpl), address(proxyAdmin), data));
        console.log("FlashAngle proxy address: ", proxy);

        vm.stopBroadcast();
    }
}