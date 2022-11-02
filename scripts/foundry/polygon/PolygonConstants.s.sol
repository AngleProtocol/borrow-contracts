// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "../../../contracts/external/ProxyAdmin.sol";
import "../../../contracts/external/TransparentUpgradeableProxy.sol";

contract PolygonConstants {
    address public constant GOVERNOR = 0xdA2D2f638D6fcbE306236583845e5822554c02EA;
    address public constant GUARDIAN = 0x3b9D32D0822A6351F415BeaB05251c1457FF6f8D;
    address public constant PROXY_ADMIN = 0xBFca293e17e067e8aBdca30A5D35ADDd0cBaE6D6;
    address public constant CORE_BORROW = 0x78754109cb73772d70A6560297037657C2AF51b8;
    uint256 public constant BASE_TOKENS = 10**18;
    uint64 public constant BASE_PARAMS = 10**9;

    function deployUpgradeable(address implementation, bytes memory data) public returns (address) {
        return address(new TransparentUpgradeableProxy(implementation, PROXY_ADMIN, data));
    }
}
