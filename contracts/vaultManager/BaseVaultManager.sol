// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.10;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/IERC721ReceiverUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/IERC721Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/introspection/ERC165Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/AddressUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/CountersUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

struct VaultParameters {
    uint256 dust;
    uint256 debtCeiling;
    uint64 collateralFactor;
    uint64 targetHealthFactor;
    uint64 dustHealthFactor;
    uint64 borrowFee;
    uint64 interestRate;
    uint64 liquidationFee;
    uint64 maxLiquidationDiscount;
    uint64 liquidationBooster;
}

// solhint-disable-next-line max-states-count
abstract contract BaseVaultManager is Initializable, PausableUpgradeable {
    using SafeERC20 for IERC20;
    using CountersUpgradeable for CountersUpgradeable.Counter;

    // TODO Pausable: see the structure and NFT contract 

    event FiledUint64(uint64 param, bytes32 what);
    event FiledUint256(uint256 param, bytes32 what);
    event FiledAddress(address param, bytes32 what);

    /// Mappings
    address public isWhitelisted;

    /// References to other contracts
    address public treasury;
    address public collateral;
    address public stablecoin;
    address public oracle;

    /// Parameters
    uint256 public dust;
    uint256 public debtCeiling;
    uint64 public collateralFactor;
    uint64 public targetHealthFactor;
    uint64 public dustHealthFactor;
    uint64 public borrowFee;
    uint64 public interestRate;
    uint64 public liquidationFee;
    uint64 public maxLiquidationDiscount;
    uint64 public liquidationBooster;

    /// Variables
    uint256 public lastInterestAccumulatorUpdated;
    uint256 public interestAccumulator;
    uint256 public totalBorrows;

    function initialize(address _treasury, address _collateral, address _stablecoin, address _oracle, VaultParameters calldata params) public initializer {
        treasury = _treasury;
        collateral = _collateral;
        stablecoin = _stablecoin;
        oracle = _oracle;
        // TODO

    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() initializer {}

    modifier onlyGuardian {
        //TODO
        _;
    }

    modifier isLiquidable(uint256 ID) {
        // TODO
        _;
    }



    function fileUint64(uint64 param, bytes32 what) external onlyGuardian {
        if (what == "collateralFactor") collateralFactor = param;
        else if (what == "targetHealthFactor") targetHealthFactor = param;
        else if (what == "dustHealthFactor") dustHealthFactor = param;
        else if (what == "borrowFee") borrowFee = param;
        else if (what == "interestRate") interestRate = param;
        else if (what == "liquidationFee") liquidationFee = param;
        else if (what == "maxLiquidationDiscount") maxLiquidationDiscount = param;
        else if (what == "liquidationBooster") liquidationBooster = param;
        emit FiledUint64(param, what);
    }

    function fileUint256(uint256 param, bytes32 what) external onlyGuardian {
        if (what == "dust") dust = param;
        else if (what == "debtCeiling") debtCeiling = param;
        emit FiledUint256(param, what);
    }

    function fileAddress(address param, bytes32 what) external onlyGuardian {
        // TODO

    }

    function createVault(uint256 collateralAmount, uint256 stablecoinAmount, address from, address toVault, address toStablecoin) external {

    }

    function closeVault(uint256 vaultID, address who, bytes[] calldata call) external {
        // TODO check exact data types

    }

    function addCollateral(uint256 vaultID, uint256 collateralAmount, address from) external {

    }

    function removeCollateral(uint256 vaultID, uint256 collateralAmount, address to) external {

    }

    function repayDebt(uint256 vaultID, uint256 stablecoinAmount, address from) external {
        
    }

    function borrow(uint256 vaultID, uint256 stablecoinAmount, address to) external {

    }

    function cook(
        uint8[] calldata actions,
        uint256[] calldata values,
        bytes[] calldata datas
    ) external payable {

    }

    function liquidate(uint256[] calldata vaultIDs) external {

    }

 


    function accrueInterest() external view virtual returns(uint256);




}