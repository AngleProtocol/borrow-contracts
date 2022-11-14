// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "../../../contracts/external/ProxyAdmin.sol";
import "../../../contracts/external/TransparentUpgradeableProxy.sol";

contract PolygonConstants {
    address public constant GOVERNOR = 0xdA2D2f638D6fcbE306236583845e5822554c02EA;
    address public constant GUARDIAN = 0x3b9D32D0822A6351F415BeaB05251c1457FF6f8D;
    address public constant PROXY_ADMIN = 0xBFca293e17e067e8aBdca30A5D35ADDd0cBaE6D6;
    address public constant CORE_BORROW = 0x78754109cb73772d70A6560297037657C2AF51b8;

    address public constant ANGLE_ROUTER = 0x892bf71463Bd9fa57f3c2266aB74dbe1B96DECEa;
    address public constant ONE_INCH = 0x1111111254fb6c44bAC0beD2854e76F90643097d;
    address public constant UNI_V3_ROUTER = 0xE592427A0AEce92De3Edee1F18E0157C05861564;

    // AGEUR Polygon treasury
    address public constant AGEUR_TREASURY = 0x2F2e0ba9746aae15888cf234c4EB5B301710927e;

    uint256 public constant BASE_TOKENS = 10**18;
    uint64 public constant BASE_PARAMS = 10**9;

    function deployUpgradeable(address implementation, bytes memory data) public returns (address) {
        return address(new TransparentUpgradeableProxy(implementation, PROXY_ADMIN, data));
    }
}
