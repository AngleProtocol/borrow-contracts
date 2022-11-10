// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import { Test } from "forge-std/Test.sol";
import { console } from "forge-std/console.sol";
import "../../../contracts/interfaces/IOracle.sol";
import "../../../contracts/treasury/Treasury.sol";
import "../../../contracts/vaultManager/vaultManager.sol";
import { OracleCrvUSDBTCETHEUR } from "../../../contracts/oracle/implementations/polygon/OracleCrvUSDBTCETH_EUR.sol";
import { IAngleRouterSidechain } from "../../../contracts/interfaces/IAngleRouterSidechain.sol";
import { IUniswapV3Router } from "../../../contracts/interfaces/external/uniswap/IUniswapRouter.sol";
import { MockCurveLevSwapperTricrypto3 } from "../../../contracts/swapper/LevSwapper/curve/implementations/polygon/polygonTest/MockCurveLevSwapperTricrypto3.sol";
import { MockCurveTokenTricrypto3Staker } from "../../../contracts/staker/curve/implementations/polygon/polygonTest/MockCurveTokenTricrypto3Staker.sol";
import "../../../scripts/foundry/polygon/PolygonConstants.s.sol";

contract DeployLPVaultManagerFullTest is Test, PolygonConstants {
    address internal constant _alice = address(uint160(uint256(keccak256(abi.encodePacked("_alice")))));

    // TODO to be changed at deployment depending on the vaultManager
    IERC20 public constant ASSET = IERC20(0xdAD97F7713Ae9437fa9249920eC8507e5FbB23d3);
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
    uint32 public constant STALE_PERIOD = 3600 * 24;

    VaultManager public vaultManagerImplementation;
    VaultManager public vaultManager;
    MockCurveTokenTricrypto3Staker public staker;

    error ZeroAdress();

    function setUp() public {
        uint256 _polygon = vm.createFork(vm.envString("ETH_NODE_URI_POLYGON"), 35438415);
        vm.selectFork(_polygon);
    }

    function testInit() public {
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

        vm.startPrank(_alice);
        IOracle oracle = new OracleCrvUSDBTCETHEUR(STALE_PERIOD, address(AGEUR_TREASURY));

        console.log("Successfully deployed Oracle tricrypto3 at the address: ", address(oracle));

        vaultManagerImplementation = new VaultManager(0, 0);

        console.log(
            "Successfully deployed vaultManagerImplementation at the address: ",
            address(vaultManagerImplementation)
        );

        MockCurveTokenTricrypto3Staker stakerImplementation = new MockCurveTokenTricrypto3Staker();
        staker = MockCurveTokenTricrypto3Staker(
            deployUpgradeable(
                address(stakerImplementation),
                abi.encodeWithSelector(stakerImplementation.initialize.selector, CORE_BORROW, ASSET)
            )
        );

        console.log(
            "Successfully deployed staker tricrypto implementation at the address: ",
            address(stakerImplementation)
        );
        console.log("Successfully deployed staker tricrypto proxy at the address: ", address(staker));

        if (
            address(vaultManagerImplementation) == address(0) ||
            address(oracle) == address(0) ||
            address(staker) == address(0)
        ) revert ZeroAdress();

        vaultManager = VaultManager(
            deployUpgradeable(
                address(vaultManagerImplementation),
                abi.encodeWithSelector(
                    vaultManagerImplementation.initialize.selector,
                    AGEUR_TREASURY,
                    IERC20(address(staker)),
                    oracle,
                    params,
                    SYMBOL
                )
            )
        );

        console.log("Successfully deployed vaultManager tricrypto at the address: ", address(vaultManager));

        MockCurveLevSwapperTricrypto3 swapper = new MockCurveLevSwapperTricrypto3(
            ICoreBorrow(CORE_BORROW),
            IUniswapV3Router(UNI_V3_ROUTER),
            ONE_INCH,
            IAngleRouterSidechain(ANGLE_ROUTER)
        );

        console.log("Successfully deployed swapper tricrypto at the address: ", address(swapper));
        vm.stopPrank();

        vm.startPrank(GOVERNOR);
        vaultManager.togglePause();
        Treasury(AGEUR_TREASURY).addVaultManager(address(vaultManager));
        vm.stopPrank();

        assertEq(staker.name(), "Angle Curve USD-BTC-ETH Staker");
        assertEq(staker.symbol(), "agstk-crvUSDBTCETH");
        assertEq(staker.decimals(), 18);
        assertEq(address(staker.liquidityGauge()), 0xCD04f35105c2E696984c512Af3CB37f2b3F354b0);

        assertEq(address(swapper.angleStaker()), address(staker));
        assertEq(address(vaultManager.collateral()), address(staker));
    }
}
