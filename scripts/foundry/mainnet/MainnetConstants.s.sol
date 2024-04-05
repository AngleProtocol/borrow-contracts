// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "../../../contracts/external/ProxyAdmin.sol";
import "../../../contracts/external/TransparentUpgradeableProxy.sol";
import { CommonUtils } from "../../../lib/utils/src/CommonUtils.sol";
import { ContractType } from "../../../lib/utils/src/Constants.sol";

contract MainnetConstants is CommonUtils {
    address constant GOVERNOR = 0xdC4e6DFe07EFCa50a197DF15D9200883eF4Eb1c8;
    address constant GUARDIAN = 0x0C2553e4B9dFA9f83b1A6D3EAB96c4bAaB42d430;
    address constant PROXY_ADMIN = 0x1D941EF0D3Bba4ad67DBfBCeE5262F4CEE53A32b;
    address constant PROXY_ADMIN_GUARDIAN = 0xD9F1A8e00b0EEbeDddd9aFEaB55019D55fcec017;
    address constant CORE_BORROW = 0x5bc6BEf80DA563EBf6Df6D6913513fa9A7ec89BE;

    address constant ANGLE_ROUTER = 0x4579709627CA36BCe92f51ac975746f431890930;
    address constant ONE_INCH = 0x1111111254EEB25477B68fb85Ed929f73A960582;
    address constant UNI_V3_ROUTER = 0xE592427A0AEce92De3Edee1F18E0157C05861564;

    // AGEUR Mainnet treasury
    address constant AGEUR_TREASURY = 0x8667DBEBf68B0BFa6Db54f550f41Be16c4067d60;
    address constant AGGOLD_TREASURY = address(0);

    uint256 constant BASE_TOKENS = 10 ** 18;
    uint64 constant BASE_PARAMS = 10 ** 9;

    /*//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                      MORPHO DATA                                                   
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////*/

    address constant EZETH = 0xbf5495Efe5DB9ce00f80364C8B423567e58d2110;
    address constant PTWeETH = 0xc69Ad9baB1dEE23F4605a82b3354F8E40d1E5966;
    address constant RSETH = 0xA1290d69c65A6Fe4DF752f95823fae25cB99e5A7;

    address constant EZETH_ETH_ORACLE = 0xF4a3e183F59D2599ee3DF213ff78b1B3b1923696;
    address constant RSETH_ETH_ORACLE = 0xA736eAe8805dDeFFba40cAB8c99bCB309dEaBd9B;
    // TODO: this one needs to be updated and changed
    address constant PTEETH_WEETH_ORACLE = 0xdDb6F90fFb4d3257dd666b69178e5B3c5Bf41136;
    address constant WEETH_USD_ORACLE = 0xdDb6F90fFb4d3257dd666b69178e5B3c5Bf41136;

    address constant CHAINLINK_ETH_USD_ORACLE = 0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419;

    address constant MORPHO_ORACLE_FACTORY = 0x3A7bB36Ee3f3eE32A60e9f2b33c1e5f2E83ad766;
    address constant MORPHO_BLUE = 0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb;
    address constant IRM_MODEL = 0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC;

    uint256 constant LLTV_86 = 0.86 ether;
    uint256 constant LLTV_77 = 0.77 ether;
    uint256 constant LLTV_62 = 0.625 ether;

    function deployUpgradeable(address implementation, bytes memory data) public returns (address) {
        return address(new TransparentUpgradeableProxy(implementation, PROXY_ADMIN, data));
    }
}
