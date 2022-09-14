// SPDX-License-Identifier: GPL-3.0

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "../interfaces/coreModule/IAgTokenMainnet.sol";
import "../interfaces/IAngleRouter.sol";
import "../interfaces/coreModule/IStableMaster.sol";
import "../interfaces/coreModule/IOracleCore.sol";
import "../interfaces/coreModule/IPoolManager.sol";
import "../interfaces/coreModule/IPerpetualManager.sol";

pragma solidity 0.8.12;

struct PerpetualManagerData {
    uint64[] xHAFeesDeposit;
    uint64[] yHAFeesDeposit;
    uint64[] xHAFeesWithdraw;
    uint64[] yHAFeesWithdraw;
    uint64 maintenanceMargin;
    uint64 maxLeverage;
    uint64 targetHAHedge;
    uint64 limitHAHedge;
    uint64 haBonusMalusDeposit;
    uint64 haBonusMalusWithdraw;
    uint64 lockTime;
    uint64 keeperFeesLiquidationRatio;
    uint256 keeperFeesLiquidationCap;
    uint256 keeperFeesClosingCap;
    uint64[] xKeeperFeesClosing;
    uint64[] yKeeperFeesClosing;
    string baseURI;
}

struct FeeManagerData {
    uint256[] xBonusMalusMint;
    uint64[] yBonusMalusMint;
    uint256[] xBonusMalusBurn;
    uint64[] yBonusMalusBurn;
    uint256[] xSlippage;
    uint64[] ySlippage;
    uint256[] xSlippageFee;
    uint64[] ySlippageFee;
    uint64 haFeeDeposit;
    uint64 haFeeWithdraw;
}

struct CollateralAddresses {
    address stableMaster;
    address poolManager;
    address perpetualManager;
    address sanToken;
    address oracle;
    address gauge;
    address feeManager;
    address[] strategies;
}

// TODO add PoolManagerData

/// @title AngleHelpers
contract AngleHelpers is Initializable {
    IAngleRouter public constant ROUTER = IAngleRouter(0xBB755240596530be0c1DE5DFD77ec6398471561d);
    address public constant CORE = 0x61ed74de9Ca5796cF2F8fD60D54160D47E30B7c3;

    bytes32 public constant STABLE = keccak256("STABLE");
    uint256 public constant BASE_PARAMS = 10**9;

    uint256 public constant MAX_ARRAY_LENGTH = 20;

    error NotInitialized();
    error InvalidAmount();

    function initialize() external initializer {}

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {}

    function previewMint(
        uint256 amount,
        address agToken,
        address collateral
    ) external view returns (uint256) {
        (uint256 amountObtained,  ) = _previewMintAndFees(amount, agToken, collateral);
        return amountObtained;
    }

    function previewBurn(
        uint256 amount,
        address agToken,
        address collateral
    ) external view returns (uint256) {
        (uint256 amountObtained, ) = _previewBurnAndFees(amount, agToken, collateral);
        return amountObtained;
    }

    function previewMintAndFees(
        uint256 amount,
        address agToken,
        address collateral
    )
        external
        view
        returns (
            uint256,
            uint256
        )
    {
        return _previewMintAndFees(amount, agToken, collateral);
    }

    function previewBurnAndFees(
        uint256 amount,
        address agToken,
        address collateral
    )
        external
        view
        returns (
            uint256,
            uint256
        )
    {
        return _previewBurnAndFees(amount, agToken, collateral);
    }

    function getCollateralAddresses(address agToken, address collateral)
        external
        view
        returns (CollateralAddresses memory addresses)
    {
        address stableMaster = IAgTokenMainnet(agToken).stableMaster();
        (address poolManager, address perpetualManager, address sanToken, address gauge) = ROUTER.mapPoolManagers(
            stableMaster,
            collateral
        );
        (, , , IOracleCore oracle, , , , , ) = IStableMaster(stableMaster).collateralMap(poolManager);
        addresses.stableMaster = stableMaster;
        addresses.poolManager = poolManager;
        addresses.perpetualManager = perpetualManager;
        addresses.sanToken = sanToken;
        addresses.gauge = gauge;
        addresses.oracle = address(oracle);
        addresses.feeManager = IPoolManager(poolManager).feeManager();

        address[] memory strategies = new address[](MAX_ARRAY_LENGTH);
        bool finished = false;
        uint256 i = 0;
        while (!finished) {
            try IPoolManager(poolManager).strategyList(i) returns (address strategy) {
                strategies[i] = strategy;
            } catch {
                finished = true;
            }
            i += 1;
        }
        addresses.strategies = strategies;
    }

    function getStablecoinAddresses() external view returns (uint256) {
        // Return list of stableMaster and list of agToken
    }

    function getCollateralParameters(address agToken, address collateral) external view returns (uint256) {
        return 0;
    }

    function getPoolManager(address agToken, address collateral) public view returns (address poolManager) {
        (, poolManager) = _getStableMasterAndPoolManager(agToken, collateral);
    }

    function _getStableMasterAndPoolManager(address agToken, address collateral)
        internal
        view
        returns (address stableMaster, address poolManager)
    {
        stableMaster = IAgTokenMainnet(agToken).stableMaster();
        (poolManager, , , ) = ROUTER.mapPoolManagers(stableMaster, collateral);
    }

    // TODO parameters
    // TODO registry

    // ======================== Replica Functions ==================================
    // These replicate what is done in the other contracts of the protocol

    function _previewBurnAndFees(
        uint256 amount,
        address agToken,
        address collateral
    )
        internal
        view
        returns (
            uint256 amountForUserInCollat,
            uint256 feePercent
        )
    {
        (address stableMaster, address poolManager) = _getStableMasterAndPoolManager(agToken, collateral);
        (
            address token,
            ,
            IPerpetualManager perpetualManager,
            IOracleCore oracle,
            uint256 stocksUsers,
            ,
            uint256 collatBase,
            ,
            MintBurnData memory feeData
        ) = IStableMaster(stableMaster).collateralMap(poolManager);
        if (token == address(0) || IStableMaster(stableMaster).paused(keccak256(abi.encodePacked(STABLE, poolManager))))
            revert NotInitialized();
        if (amount > stocksUsers) revert InvalidAmount();

        if (feeData.xFeeBurn.length == 1) {
            feePercent = feeData.yFeeBurn[0];
        } else {
            bytes memory data = abi.encode(address(perpetualManager), feeData.targetHAHedge);
            uint64 hedgeRatio = _computeHedgeRatio(stocksUsers - amount, data);
            feePercent = _piecewiseLinear(hedgeRatio, feeData.xFeeBurn, feeData.yFeeBurn);
        }
        feePercent = (feePercent * feeData.bonusMalusBurn) / BASE_PARAMS;

        amountForUserInCollat = (amount * (BASE_PARAMS - feePercent) * collatBase) / (oracle.readUpper() * BASE_PARAMS);
    }

    function _previewMintAndFees(
        uint256 amount,
        address agToken,
        address collateral
    )
        internal
        view
        returns (
            uint256 amountForUserInStable,
            uint256 feePercent
        )
    {
        (address stableMaster, address poolManager) = _getStableMasterAndPoolManager(agToken, collateral);
        (
            address token,
            ,
            IPerpetualManager perpetualManager,
            IOracleCore oracle,
            uint256 stocksUsers,
            ,
            ,
            ,
            MintBurnData memory feeData
        ) = IStableMaster(stableMaster).collateralMap(poolManager);
        if (token == address(0) || IStableMaster(stableMaster).paused(keccak256(abi.encodePacked(STABLE, poolManager))))
            revert NotInitialized();

        amountForUserInStable = oracle.readQuoteLower(amount);


        if (feeData.xFeeMint.length == 1) feePercent = feeData.yFeeMint[0];
        else {
            bytes memory data = abi.encode(address(perpetualManager), feeData.targetHAHedge);
            uint64 hedgeRatio = _computeHedgeRatio(amountForUserInStable + stocksUsers, data);
            feePercent = _piecewiseLinear(hedgeRatio, feeData.xFeeMint, feeData.yFeeMint);
        }
        feePercent = (feePercent * feeData.bonusMalusMint) / BASE_PARAMS;

        amountForUserInStable = (amountForUserInStable * (BASE_PARAMS - feePercent)) / BASE_PARAMS;
        if (stocksUsers + amountForUserInStable > feeData.capOnStableMinted) revert InvalidAmount();
    }

    // ======================== Utility Functions ==================================
    // These are copy pasted from other contracts

    function _computeHedgeRatio(
        uint256 newStocksUsers,
        bytes memory data
    ) internal view returns (uint64 ratio) {
        (address perpetualManager, uint64 targetHAHedge) = abi.decode(data, (address, uint64));
        uint256 totalHedgeAmount = IPerpetualManager(perpetualManager).totalHedgeAmount();
        newStocksUsers = (targetHAHedge * newStocksUsers) / BASE_PARAMS;
        if (newStocksUsers > totalHedgeAmount) ratio = uint64((totalHedgeAmount * BASE_PARAMS) / newStocksUsers);
        else ratio = uint64(BASE_PARAMS);
    }

    function _piecewiseLinear(
        uint64 x,
        uint64[] memory xArray,
        uint64[] memory yArray
    ) internal pure returns (uint64) {
        if (x >= xArray[xArray.length - 1]) {
            return yArray[xArray.length - 1];
        } else if (x <= xArray[0]) {
            return yArray[0];
        } else {
            uint256 lower;
            uint256 upper = xArray.length - 1;
            uint256 mid;
            while (upper - lower > 1) {
                mid = lower + (upper - lower) / 2;
                if (xArray[mid] <= x) {
                    lower = mid;
                } else {
                    upper = mid;
                }
            }
            if (yArray[upper] > yArray[lower]) {
                return
                    yArray[lower] +
                    ((yArray[upper] - yArray[lower]) * (x - xArray[lower])) /
                    (xArray[upper] - xArray[lower]);
            } else {
                return
                    yArray[lower] -
                    ((yArray[lower] - yArray[upper]) * (x - xArray[lower])) /
                    (xArray[upper] - xArray[lower]);
            }
        }
    }
}
