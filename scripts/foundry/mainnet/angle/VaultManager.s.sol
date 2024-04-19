// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "forge-std/Script.sol";
import { console } from "forge-std/console.sol";
import { IOracle } from "../../../../contracts/interfaces/IOracle.sol";
import { OracleETHXAUChainlink } from "../../../../contracts/oracle/implementations/mainnet/XAU/OracleETHXAUChainlink.sol";
import { Treasury, ITreasury } from "../../../../contracts/treasury/Treasury.sol";
import { IAgToken, AgToken } from "../../../../contracts/agToken/AgToken.sol";
import { VaultManagerLiquidationBoost, VaultParameters, VaultManagerStorage, IERC20 } from "../../../../contracts/vaultManager/VaultManagerLiquidationBoost.sol";
import "../MainnetConstants.s.sol";

contract DeployVaultManagerMainnet is Script, MainnetConstants {
    // TODO to be changed at deployment depending on the vaultManager
    IERC20 public constant COLLATERAL = IERC20(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2);

    string public constant SYMBOL = "ETH-GOLD";
    uint256 public constant DEBT_CEILING = 100 ether;
    uint64 public constant CF = (85 * BASE_PARAMS) / 10;
    uint64 public constant THF = (105 * BASE_PARAMS) / 100;
    uint64 public constant BORROW_FEE = 0;
    uint64 public constant REPAY_FEE = 0;
    uint64 public constant INTEREST_RATE = 158153934393112649;
    uint64 public constant LIQUIDATION_SURCHARGE = (98 * BASE_PARAMS) / 100;
    uint64 public constant MAX_LIQUIDATION_DISCOUNT = (8 * BASE_PARAMS) / 100;
    uint256 public constant BASE_BOOST = (25 * BASE_PARAMS) / 10;
    uint32 public constant STALE_PERIOD = 3600 * 48;

    VaultManagerLiquidationBoost public vaultManager;
    IOracle public oracle;

    error ZeroAdress();

    function run() external {
        VaultParameters memory params = VaultParameters({
            debtCeiling: DEBT_CEILING,
            collateralFactor: CF,
            targetHealthFactor: THF,
            interestRate: INTEREST_RATE,
            liquidationSurcharge: LIQUIDATION_SURCHARGE,
            maxLiquidationDiscount: MAX_LIQUIDATION_DISCOUNT,
            baseBoost: BASE_BOOST,
            // useless param in this case
            whitelistingActivated: false
        });

        uint256 deployerPrivateKey = vm.deriveKey(vm.envString("MNEMONIC_MAINNET"), 0);
        vm.startBroadcast(deployerPrivateKey);

        oracle = new OracleETHXAUChainlink(STALE_PERIOD, address(AGGOLD_TREASURY));

        console.log("Successfully deployed oracle ETH_GOLD at the address: ", address(oracle));

        if (
            address(AGGOLD_TREASURY) == address(0) || address(COLLATERAL) == address(0) || address(oracle) == address(0)
        ) revert ZeroAdress();

        vaultManager = new VaultManagerLiquidationBoost();
        vaultManager.initialize(ITreasury(AGGOLD_TREASURY), COLLATERAL, oracle, params, SYMBOL);

        console.log("Successfully deployed vaultManager ETH-GOLD at the address: ", address(vaultManager));

        // TODO Governance should add vaultManager to Treasury
        Treasury(AGGOLD_TREASURY).addVaultManager(address(vaultManager));

        vm.stopBroadcast();
    }
}
