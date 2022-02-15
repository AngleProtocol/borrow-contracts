// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.10;

import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/interfaces/IERC3156FlashBorrower.sol";
import "@openzeppelin/contracts/interfaces/IERC3156FlashLender.sol";

import "../interfaces/IAgToken.sol";
import "../interfaces/ICoreBorrow.sol";
import "../interfaces/IFlashAngle.sol";
import "../interfaces/ITreasury.sol";

/// @title FlashAngle
/// @author Angle Core Team
/// @notice Contract to take flash loans on top of several AgToken contracts
contract FlashAngle is IERC3156FlashLender, IFlashAngle, Initializable, ReentrancyGuardUpgradeable {
    /// @notice Base used for parameter computation
    uint256 public constant BASE_PARAMS = 10**9;
    /// @notice Success message received when calling a `FlashBorrower` contract
    bytes32 public constant CALLBACK_SUCCESS = keccak256("ERC3156FlashBorrower.onFlashLoan");

    /// @notice Struct encoding for a given stablecoin the parameters
    struct StablecoinData {
        // Treasury address responsible
        address treasury;
        // Maximum amount borrowable for this stablecoin
        uint256 maxBorrowable;
        // Flash loan fee taken by the protocol for a flash loan on this stablecoin
        uint64 flashLoanFee;
    }

    // ======================= Parameters and References ===========================

    /// @notice Maps a stablecoin to the data and parameters for flash loans
    mapping(IAgToken => StablecoinData) public stablecoinMap;
    /// @inheritdoc IFlashAngle
    ICoreBorrow public override core;

    /// @notice Initializes the contract
    /// @param _core Core address handling this module
    function initialize(ICoreBorrow _core) public initializer {
        core = _core;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() initializer {}

    // =================================== Modifiers ===============================

    /// @notice Checks whether the sender is the core contract
    modifier onlyCore() {
        require(msg.sender == address(core), "10");
        _;
    }

    /// @notice Checks whether a given stablecoin has been initialized in this contract
    /// @param stablecoin Stablecoin to check
    /// @dev To check whether a stablecoin has been initialized, we just need to check whether its associated
    /// `treasury` address is not null in the `stablecoinMap`. This is what's checked in the `CoreBorrow` contract
    /// when adding support for a stablecoin
    modifier onlyExistingStablecoin(IAgToken stablecoin) {
        require(stablecoinMap[stablecoin].treasury != address(0), "13");
        _;
    }

    // ================================ ERC3156 Spec ===============================

    /// @inheritdoc IERC3156FlashLender
    function flashFee(address token, uint256 amount) external view override returns (uint256) {
        return _flashFee(token, amount);
    }

    /// @inheritdoc IERC3156FlashLender
    function maxFlashLoan(address token) external view override returns (uint256) {
        IAgToken stablecoin = IAgToken(token);
        if (stablecoinMap[stablecoin].treasury != address(0) && stablecoin.isMinter(address(this))) {
            return stablecoinMap[stablecoin].maxBorrowable;
        } else {
            return 0;
        }
    }

    /// @inheritdoc IERC3156FlashLender
    function flashLoan(
        IERC3156FlashBorrower receiver,
        address token,
        uint256 amount,
        bytes calldata data
    ) external override nonReentrant returns (bool) {
        uint256 fee = _flashFee(token, amount);
        require(amount <= stablecoinMap[IAgToken(token)].maxBorrowable, "4");
        IAgToken(token).mint(address(receiver), amount);
        require(receiver.onFlashLoan(msg.sender, token, amount, fee, data) == CALLBACK_SUCCESS);
        IAgToken(token).transferFrom(address(receiver), address(this), amount + fee);
        IAgToken(token).burnSelf(amount, address(this));
        return true;
    }

    /// @notice Internal function to compute the fee induced for taking a flash loan of `amount` of `token`
    /// @param token The loan currency
    /// @param amount The amount of tokens lent
    /// @dev This function will revert if the `token` requested is not whitelisted here
    function _flashFee(address token, uint256 amount)
        internal
        view
        onlyExistingStablecoin(IAgToken(token))
        returns (uint256)
    {
        return (amount * stablecoinMap[IAgToken(token)].flashLoanFee) / BASE_PARAMS;
    }

    // ============================ Treasury Only Function =========================

    /// @inheritdoc IFlashAngle
    function accrueInterestToTreasury(IAgToken stablecoin) external override returns (uint256 balance) {
        address treasury = stablecoinMap[stablecoin].treasury;
        require(msg.sender == treasury, "14");
        balance = stablecoin.balanceOf(address(this));
        stablecoin.transfer(treasury, balance);
    }

    // =========================== Governance Only Function ========================

    /// @notice Sets the parameters for a given stablecoin
    /// @param stablecoin Stablecoin to change the parameters for
    /// @param _flashLoanFee New flash loan fee for this stablecoin
    /// @param _maxBorrowable Maximum amount that can be borrowed in a single flash loan
    /// @dev Setting a `maxBorrowable` parameter equal to 0 is a way to pause the functionality
    /// @dev Parameters can only be modified for whitelisted stablecoins
    function setFlashLoanParameters(
        IAgToken stablecoin,
        uint64 _flashLoanFee,
        uint256 _maxBorrowable
    ) external onlyExistingStablecoin(stablecoin) {
        require(core.isGovernorOrGuardian(msg.sender), "2");
        require(_flashLoanFee <= BASE_PARAMS, "9");
        stablecoinMap[stablecoin].flashLoanFee = _flashLoanFee;
        stablecoinMap[stablecoin].maxBorrowable = _maxBorrowable;
    }

    // =========================== CoreBorrow Only Functions =======================

    /// @inheritdoc IFlashAngle
    function addStablecoinSupport(address _treasury) external override onlyCore {
        stablecoinMap[IAgToken(ITreasury(_treasury).stablecoin())].treasury = _treasury;
    }

    /// @inheritdoc IFlashAngle
    function removeStablecoinSupport(address _treasury) external override onlyCore {
        delete stablecoinMap[IAgToken(ITreasury(_treasury).stablecoin())];
    }

    /// @inheritdoc IFlashAngle
    function setCore(address _core) external override onlyCore {
        core = ICoreBorrow(_core);
    }
}
