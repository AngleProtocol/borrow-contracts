// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "../../../contracts/external/ProxyAdmin.sol";
import "../../../contracts/external/TransparentUpgradeableProxy.sol";

contract MainnetConstants {
    address public constant GOVERNOR = 0xdC4e6DFe07EFCa50a197DF15D9200883eF4Eb1c8;
    address public constant GUARDIAN = 0x0C2553e4B9dFA9f83b1A6D3EAB96c4bAaB42d430;
    address public constant PROXY_ADMIN = 0x1D941EF0D3Bba4ad67DBfBCeE5262F4CEE53A32b;
    address public constant PROXY_ADMIN_GUARDIAN = 0xD9F1A8e00b0EEbeDddd9aFEaB55019D55fcec017;
    address public constant CORE_BORROW = 0x5bc6BEf80DA563EBf6Df6D6913513fa9A7ec89BE;

    address public constant ANGLE_ROUTER = 0x4579709627CA36BCe92f51ac975746f431890930;
    address public constant ONE_INCH = 0x1111111254EEB25477B68fb85Ed929f73A960582;
    address public constant UNI_V3_ROUTER = 0xE592427A0AEce92De3Edee1F18E0157C05861564;

    // AGEUR Mainnet treasury
    address public constant AGEUR_TREASURY = 0x8667DBEBf68B0BFa6Db54f550f41Be16c4067d60;
    address public constant AGGOLD_TREASURY = address(0);

    uint256 public constant BASE_TOKENS = 10 ** 18;
    uint64 public constant BASE_PARAMS = 10 ** 9;

    function deployUpgradeable(address implementation, bytes memory data) public returns (address) {
        return address(new TransparentUpgradeableProxy(implementation, PROXY_ADMIN, data));
    }
}
