// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.10;

import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/interfaces/IERC3156FlashBorrower.sol";
import "@openzeppelin/contracts/interfaces/IERC3156FlashLender.sol";

import "../interfaces/IAgToken.sol";
import "../interfaces/ICoreBorrow.sol";
import "../interfaces/IFlashAngle.sol";
import "../interfaces/ITreasury.sol";

// OpenZeppelin may update its version of the ERC20PermitUpgradeable token

// TODO with mapping

struct StablecoinData {
    address treasury;
    uint256 maxBorrowable;
    uint64 flashLoanFee;
}

/// @title FlashAngle
/// @author Angle Core Team
/// @notice Contract to take flash loans on top of an AgToken contract
/// @dev This contract is used to create and handle the stablecoins of Angle protocol
/// @dev Only the `StableMaster` contract can mint or burn agTokens
/// @dev It is still possible for any address to burn its agTokens without redeeming collateral in exchange
contract FlashAngle is IERC3156FlashLender, IFlashAngle, Initializable, ReentrancyGuardUpgradeable {
    uint256 public constant BASE_PARAMS = 10**9;
    bytes32 public constant CALLBACK_SUCCESS = keccak256("ERC3156FlashBorrower.onFlashLoan");

    mapping(IAgToken => StablecoinData) public stablecoinMap;
    ICoreBorrow public core;

    // Pausable
    // Treasury can rule it and governor can set fees for it
    function initialize(
        ICoreBorrow _core,
        address _treasury,
        uint256 _maxBorrowable,
        uint64 _flashLoanFee
    ) public initializer {
        require(_flashLoanFee <= BASE_PARAMS);
        require(address(core) != address(0));
        core = _core;
        IAgToken stablecoin = IAgToken(ITreasury(_treasury).stablecoin());
        StablecoinData storage firstStablecoinData = stablecoinMap[stablecoin];
        firstStablecoinData.treasury = _treasury;
        firstStablecoinData.flashLoanFee = _flashLoanFee;
        firstStablecoinData.maxBorrowable = _maxBorrowable;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() initializer {}

    modifier onlyGovernorOrGuardian() {
        require(core.isGovernorOrGuardian(msg.sender));
        _;
    }

    modifier onlyGovernor() {
        require(core.isGovernor(msg.sender));
        _;
    }

    modifier onlyCore() {
        require(msg.sender == address(core));
        _;
    }

    modifier onlyExistingStablecoin(IAgToken stablecoin) {
        require(stablecoinMap[stablecoin].treasury != address(0));
        _;
    }

    function setFlashLoanFee(uint64 _flashLoanFee, IAgToken stablecoin)
        external
        onlyGovernorOrGuardian
        onlyExistingStablecoin(stablecoin)
    {
        require(_flashLoanFee <= BASE_PARAMS);
        stablecoinMap[stablecoin].flashLoanFee = _flashLoanFee;
    }

    function setMaxBorrowable(uint256 _maxBorrowable, IAgToken stablecoin)
        external
        onlyGovernorOrGuardian
        onlyExistingStablecoin(stablecoin)
    {
        stablecoinMap[stablecoin].maxBorrowable = _maxBorrowable;
    }

    function addStablecoinSupport(address _treasury) external override onlyCore {
        stablecoinMap[IAgToken(ITreasury(_treasury).stablecoin())].treasury = _treasury;
    }

    function removeStablecoinSupport(address _treasury) external override onlyCore {
        delete stablecoinMap[IAgToken(ITreasury(_treasury).stablecoin())];
    }

    // --- ERC 3156 Spec ---
    function flashFee(address token, uint256 amount) external view override returns (uint256) {
        return _flashFee(token, amount);
    }

    function maxFlashLoan(address token) external view override returns (uint256) {
        IAgToken stablecoin = IAgToken(token);
        if (stablecoinMap[stablecoin].treasury != address(0) && stablecoin.isMinter(address(this))) {
            return stablecoinMap[stablecoin].maxBorrowable;
        } else {
            return 0;
        }
    }

    function _flashFee(address token, uint256 amount)
        internal
        view
        onlyExistingStablecoin(IAgToken(token))
        returns (uint256)
    {
        return (amount * stablecoinMap[IAgToken(token)].flashLoanFee) / BASE_PARAMS;
    }

    // To pause the contract you just have to set max borrowable to 0
    function flashLoan(
        IERC3156FlashBorrower receiver,
        address token,
        uint256 amount,
        bytes calldata data
    ) external override nonReentrant returns (bool) {
        uint256 fee = _flashFee(token, amount);
        require(amount <= stablecoinMap[IAgToken(token)].maxBorrowable);
        IAgToken(token).mint(address(receiver), amount);
        require(receiver.onFlashLoan(msg.sender, token, amount, fee, data) == CALLBACK_SUCCESS);
        IAgToken(token).transferFrom(address(receiver), address(this), amount + fee);
        IAgToken(token).burnSelf(amount, address(this));
        return true;
    }

    function accrueInterestToTreasury(IAgToken stablecoin) external override returns (uint256 balance) {
        address treasury = stablecoinMap[stablecoin].treasury;
        require(treasury != address(0));
        balance = stablecoin.balanceOf(address(this));
        stablecoin.transfer(treasury, balance);
    }
}
