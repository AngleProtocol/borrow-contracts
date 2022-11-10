// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "forge-std/Script.sol";
import "../../../contracts/interfaces/IOracle.sol";
import "../../../contracts/treasury/Treasury.sol";
import "../../../contracts/vaultManager/vaultManager.sol";
import "./PolygonConstants.s.sol";

contract DeployVaultManager is Script, PolygonConstants {
    address public constant TREASURY = 0x2F2e0ba9746aae15888cf234c4EB5B301710927e;
    VaultManager public constant VAULT_MANAGER_IMPL = VaultManager(address(0));

    // TODO to be changed at deployment depending on the vaultManager
    IOracle public constant ORACLE = IOracle(address(0));
    // the staker address
    IERC20 public constant COLLATERAL = IERC20(address(0));
    string public constant SYMBOL = "crvUSDBTCETH-EUR";
    uint256 public constant DEBT_CEILING = 1_000 ether;
    uint64 public constant CF = (7 * BASE_PARAMS) / 10;
    uint64 public constant THF = (11 * BASE_PARAMS) / 10;
    uint64 public constant BORROW_FEE = (3 * BASE_PARAMS) / 1000;
    uint64 public constant REPAY_FEE = (4 * BASE_PARAMS) / 1000;
    uint64 public constant INTEREST_RATE = 158153934393112649;
    uint64 public constant LIQUIDATION_SURCHARGE = (98 * BASE_PARAMS) / 100;
    uint64 public constant MAX_LIQUIDATION_DISCOUNT = (8 * BASE_PARAMS) / 100;
    bool public constant WHITELISTING_ACTIVATED = false;
    uint256 public constant BASE_BOOST = (4 * BASE_PARAMS) / 10;

    VaultManager public vaultManager;

    error ZeroAdress();

    function run() external {
        VaultParameters memory params = VaultParameters({
            debtCeiling: DEBT_CEILING,
            collateralFactor: CF,
            targetHealthFactor: THF,
            interestRate: INTEREST_RATE,
            liquidationSurcharge: LIQUIDATION_SURCHARGE,
            maxLiquidationDiscount: MAX_LIQUIDATION_DISCOUNT,
            whitelistingActivated: WHITELISTING_ACTIVATED,
            baseBoost: BASE_BOOST
        });

        uint256 deployerPrivateKey = vm.deriveKey(vm.envString("MNEMONIC_POLYGON"), 0);
        vm.startBroadcast(deployerPrivateKey);

        if (
            address(VAULT_MANAGER_IMPL) == address(0) ||
            address(ORACLE) == address(0) ||
            address(COLLATERAL) == address(0)
        ) revert ZeroAdress();

        vaultManager = VaultManager(
            deployUpgradeable(
                address(VAULT_MANAGER_IMPL),
                abi.encodeWithSelector(
                    VAULT_MANAGER_IMPL.initialize.selector,
                    TREASURY,
                    COLLATERAL,
                    ORACLE,
                    params,
                    SYMBOL
                )
            )
        );

        console.log("Successfully deployed vaultManager tricrypto at the address: ", address(vaultManager));

        vm.stopBroadcast();
    }
}
