// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.10;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../interfaces/IAgToken.sol";
import "../interfaces/ICoreBorrow.sol";
import "../interfaces/ITreasury.sol";
import "../interfaces/IFlashAngle.sol";
import "../interfaces/IVaultManager.sol";

/// @title Treasury
/// @author Angle Core Team
/// @notice Treasury of Angle Borrowing Module doing the accounting across all VaultManagers
contract Treasury is ITreasury, Initializable {
    using SafeERC20 for IERC20;

    uint256 public constant BASE_PARAMS = 10**9;

    IAgToken public stablecoin;
    ICoreBorrow public core;
    IFlashAngle public flashLoanModule;
    address public surplusManager;
    uint256 public badDebt;
    // Surplus to be distributed and not yet taken into account, otherwise surplus is taken into account
    // as just the balance in the protocol
    uint256 public surplusBuffer;
    uint64 public surplusForGovernance;

    mapping(address => bool) public vaultManagerMap;
    address[] public vaultManagerList;

    event Recovered(address indexed token, address indexed to, uint256 amount);

    function initialize(
        ICoreBorrow _core,
        IAgToken _stablecoin,
        address _surplusManager
    ) public initializer {
        require(
            address(_stablecoin) != address(0) && surplusManager != address(0) && address(_core) != address(0),
            "O"
        );
        core = _core;
        stablecoin = _stablecoin;
        surplusManager = _surplusManager;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() initializer {}

    modifier onlyGovernor() {
        require(core.isGovernor(msg.sender));
        _;
    }

    function isVaultManager(address vaultManager) external view override returns (bool) {
        return vaultManagerMap[vaultManager];
    }

    function isGovernor(address admin) external view override returns (bool) {
        return core.isGovernor(admin);
    }

    function isGovernorOrGuardian(address admin) external view override returns (bool) {
        return core.isGovernorOrGuardian(admin);
    }

    function addVaultManager(address vaultManager) external onlyGovernor {
        require(!vaultManagerMap[vaultManager]);
        vaultManagerMap[vaultManager] = true;
        stablecoin.addMinter(vaultManager);
    }

    function removeVaultManager(address vaultManager) external onlyGovernor {
        require(vaultManagerMap[vaultManager]);
        uint256 vaultManagerListLength = vaultManagerList.length;
        for (uint256 i = 0; i < vaultManagerListLength - 1; i++) {
            if (vaultManagerList[i] == vaultManager) {
                vaultManagerList[i] = vaultManagerList[vaultManagerListLength - 1];
                break;
            }
        }
        vaultManagerList.pop();
        stablecoin.removeMinter(vaultManager);
    }

    function setFlashLoanModule(address _flashLoanModule) external override {
        require(msg.sender == address(core));
        address oldFlashLoanModule = address(flashLoanModule);
        if (oldFlashLoanModule != address(0)) {
            stablecoin.removeMinter(oldFlashLoanModule);
        }
        // We may want to cancel the module
        if (_flashLoanModule != address(0)) {
            stablecoin.addMinter(_flashLoanModule);
        }
        flashLoanModule = IFlashAngle(_flashLoanModule);
    }

    function addMinter(address minter) external onlyGovernor {
        stablecoin.addMinter(minter);
    }

    function removeMinter(address minter) external onlyGovernor {
        // If you want to remove the minter role to a vaultManager you have to make sure it no longer has the vaultManager role
        require(!vaultManagerMap[minter]);
        stablecoin.removeMinter(minter);
    }

    function setSurplusForGovernance(uint64 _surplusForGovernance) external onlyGovernor {
        surplusForGovernance = _surplusForGovernance;
    }

    function setSurplusManager(address _surplusManager) external onlyGovernor {
        require(surplusManager != address(0), "0");
        surplusManager = _surplusManager;
    }

    function fetchSurplusFromAll() external {
        _fetchSurplusFromAll();
    }

    function _updateSurplusBadDebt(uint256 surplusBufferValue, uint256 badDebtValue)
        internal
        returns (uint256, uint256)
    {
        if (badDebtValue > 0) {
            // If we have bad debt we need to burn stablecoins that accrued to the protocol
            uint256 balance = stablecoin.balanceOf(address(this));
            uint256 toBurn = balance > badDebtValue ? badDebtValue : balance;
            stablecoin.burnSelf(toBurn, address(this));
            if (toBurn < badDebtValue) {
                surplusBufferValue = 0;
                badDebtValue -= toBurn;
            } else {
                surplusBufferValue = toBurn >= surplusBufferValue ? 0 : surplusBufferValue - toBurn;
                badDebtValue = 0;
            }
        }
        surplusBuffer = surplusBufferValue;
        badDebt = badDebtValue;
        return (surplusBufferValue, badDebtValue);
    }

    function _fetchSurplusFromAll() internal returns (uint256 surplusBufferValue, uint256 badDebtValue) {
        // tracks value of the bad debt at the end of the call
        badDebtValue = badDebt;
        // tracks value of the surplus buffer at the end of the call
        surplusBufferValue = surplusBuffer;
        uint256 vaultManagerListLength = vaultManagerList.length;
        uint256 newSurplus;
        uint256 newBadDebt;
        for (uint256 i = 0; i < vaultManagerListLength; i++) {
            (newSurplus, newBadDebt) = IVaultManager(vaultManagerList[i]).accrueInterestToTreasury();
            surplusBufferValue += newSurplus;
            badDebtValue += newBadDebt;
        }
        if (address(flashLoanModule) != address(0)) {
            surplusBufferValue += flashLoanModule.accrueInterestToTreasury(stablecoin);
        }
        (surplusBufferValue, badDebtValue) = _updateSurplusBadDebt(surplusBufferValue, badDebtValue);
    }

    function fetchSurplusFromVaultManagers(address[] memory vaultManagers)
        external
        returns (uint256 surplusBufferValue, uint256 badDebtValue)
    {
        badDebtValue = badDebt;
        surplusBufferValue = surplusBuffer;
        uint256 newSurplus;
        uint256 newBadDebt;
        for (uint256 i = 0; i < vaultManagers.length; i++) {
            (newSurplus, newBadDebt) = IVaultManager(vaultManagers[i]).accrueInterestToTreasury();
            surplusBufferValue += newSurplus;
            badDebtValue += newBadDebt;
        }
        (surplusBufferValue, badDebtValue) = _updateSurplusBadDebt(surplusBufferValue, badDebtValue);
    }

    function fetchSurplusFromFlashLoan() external returns (uint256 surplusBufferValue, uint256 badDebtValue) {
        // it will fail if flashLoanModule is 0 address -> no need for a require
        badDebtValue = badDebt;
        surplusBufferValue = surplusBuffer + flashLoanModule.accrueInterestToTreasury(stablecoin);
        (surplusBufferValue, badDebtValue) = _updateSurplusBadDebt(surplusBufferValue, badDebtValue);
    }

    function pullSurplus() external {
        // Needed to fetch surplus from everywhere in case of
        (uint256 surplusBufferValue, ) = _fetchSurplusFromAll();
        surplusBuffer = 0;
        stablecoin.transfer(surplusManager, (surplusForGovernance * surplusBufferValue) / BASE_PARAMS);
    }

    // Can be called of some stablecoins have accrued to the contract for some reason -> like Olympus Pro or so
    function updateBadDebt(uint256 amount) external {
        // Cannot burn more han the badDebt otherwise could be used to manipulate `surplusBuffer` going to users
        require(amount <= badDebt);
        stablecoin.burnSelf(amount, address(this));
        badDebt -= amount;
    }

    function recoverERC20(
        address tokenAddress,
        address to,
        uint256 amountToRecover
    ) external onlyGovernor {
        // Cannot recover stablecoin if badDebt or tap into the surplus buffer
        if (tokenAddress == address(stablecoin)) {
            require(badDebt == 0);
            uint256 balance = stablecoin.balanceOf(address(this));
            // Should fetch here from surplus
            require(amountToRecover <= balance - surplusBuffer);
            stablecoin.transfer(to, amountToRecover);
        } else {
            IERC20(tokenAddress).safeTransfer(to, amountToRecover);
        }
        emit Recovered(tokenAddress, to, amountToRecover);
    }
}
