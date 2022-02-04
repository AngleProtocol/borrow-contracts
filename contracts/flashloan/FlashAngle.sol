// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.10;

import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/interfaces/IERC3156FlashBorrower.sol";
import "@openzeppelin/contracts/interfaces/IERC3156FlashLender.sol";

import "../interfaces/IAgToken.sol";
import "../interfaces/ITreasury.sol";
// OpenZeppelin may update its version of the ERC20PermitUpgradeable token

/// @title FlashAngle
/// @author Angle Core Team
/// @notice Contract to take flash loans on top of an AgToken contract
/// @dev This contract is used to create and handle the stablecoins of Angle protocol
/// @dev Only the `StableMaster` contract can mint or burn agTokens
/// @dev It is still possible for any address to burn its agTokens without redeeming collateral in exchange
contract FlashAngle is Pausable, ReentrancyGuard, IERC3156FlashLender {

    uint256 public constant BASE_PARAMS = 10**9;
    bytes32 public constant CALLBACK_SUCCESS = keccak256("ERC3156FlashBorrower.onFlashLoan");

    ITreasury public treasury;
    IAgToken public stablecoin;
    uint64 public flashLoanFee;
    uint256 public maxBorrowable;

    // Pausable 
    // Treasury can rule it and governor can set fees for it
    constructor(ITreasury _treasury, uint64 _flashLoanFee) {
        require(_flashLoanFee <= BASE_PARAMS);
        flashLoanFee = _flashLoanFee;
        treasury = _treasury;
        stablecoin = IAgToken(_treasury.stablecoin());

    }

    modifier onlyGovernorOrGuardian() {
        require(treasury.isGovernorOrGuardian(msg.sender));
        _;
    }

    modifier onlyGovernor() {
        require(treasury.isGovernor(msg.sender));
        _;
    }

    function pause() external onlyGovernorOrGuardian {
        _pause();
    }

    function unpause() external onlyGovernorOrGuardian {
        _unpause();
    }

    function setFlashLoanFee(uint64 _flashLoanFee) external onlyGovernorOrGuardian {
        require(_flashLoanFee <= BASE_PARAMS);
        flashLoanFee = _flashLoanFee;
    }

    function setMaxBorrowable(uint256 _maxBorrowable) external onlyGovernorOrGuardian {
        maxBorrowable = _maxBorrowable;
    }

    function setTreasury(ITreasury _treasury) external onlyGovernor {
        require(_treasury.isGovernor(msg.sender) && _treasury.stablecoin() == stablecoin);
        treasury = _treasury;
    }

    // --- ERC 3156 Spec ---
    function flashFee(address token, uint256 amount) external view override returns(uint256) {
        return _flashFee(token,amount);
    }

    function maxFlashLoan(address token) external view override returns (uint256) {
        if(token == address(stablecoin) && !paused() && stablecoin.isMinter(address(this))) {
            return maxBorrowable;
        } else {
            return 0;
        }
    }

    function _flashFee(address token, uint256 amount) internal view returns(uint256) {
        require(token == address(stablecoin));
        return amount * flashLoanFee / BASE_PARAMS;
    }

    function flashLoan(
        IERC3156FlashBorrower receiver,
        address token,
        uint256 amount,
        bytes calldata data
    ) external override nonReentrant whenNotPaused returns (bool) {
        require(amount <= maxBorrowable);
        uint256 fee = _flashFee(token, amount);
        IAgToken(token).mint(address(receiver), amount);
        require(receiver.onFlashLoan(msg.sender, token, amount, fee, data) == CALLBACK_SUCCESS);
        IAgToken(token).transferFrom(address(receiver), address(this), amount + fee);
        IAgToken(token).burnSelf(amount, address(this));
        return true;
    }








}