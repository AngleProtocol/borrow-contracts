// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.10;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlEnumerableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../interfaces/IAgToken.sol";
import "../interfaces/ITreasury.sol";
import "../interfaces/IVaultManager.sol";

/// @title Treasury
/// @author Angle Core Team
/// @notice Treasury of Angle Borrowing Module doing the accounting across all VaultManagers
contract Treasury is ITreasury, Initializable, AccessControlEnumerableUpgradeable {
    using SafeERC20 for IERC20;

    /// @notice Role for guardians
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");
    /// @notice Role for governors
    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");
    /// @notice Role for VaultManagers only
    bytes32 public constant VAULTMANAGER_ROLE = keccak256("VAULTMANAGER_ROLE");

    uint256 public constant BASE_PARAMS = 10**9;

    IAgToken public stablecoin;
    address public surplusManager;
    uint256 public badDebt;
    // Surplus to be distributed and not yet taken into account, otherwise surplus is taken into account
    // as just the balance in the protocol
    uint256 public surplusBuffer;
    uint64 public surplusForGovernance;

    event Recovered(address indexed token, address indexed to, uint256 amount);

    function initialize(
        address governor,
        address guardian,
        address _stablecoin,
        address _surplusManager
    ) public initializer {
        require(
            governor != address(0) &&
                guardian != address(0) &&
                _stablecoin != address(0) &&
                surplusManager != address(0),
            "O"
        );
        _setupRole(GOVERNOR_ROLE, governor);
        _setupRole(GUARDIAN_ROLE, guardian);
        _setupRole(GUARDIAN_ROLE, governor);
        _setRoleAdmin(GUARDIAN_ROLE, GOVERNOR_ROLE);
        _setRoleAdmin(GOVERNOR_ROLE, GOVERNOR_ROLE);
        _setRoleAdmin(VAULTMANAGER_ROLE, GOVERNOR_ROLE);
        stablecoin = IAgToken(_stablecoin);
        surplusManager = _surplusManager;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() initializer {}

    function isVaultManager(address vaultManager) external view override returns (bool) {
        return hasRole(VAULTMANAGER_ROLE, vaultManager);
    }

    function isGovernor(address admin) external view override returns (bool) {
        return hasRole(GOVERNOR_ROLE, admin);
    }

    function isGovernorOrGuardian(address admin) external view override returns (bool) {
        return hasRole(GUARDIAN_ROLE, admin);
    }

    function setSurplusForGovernance(uint64 _surplusForGovernance) external onlyRole(GOVERNOR_ROLE) {
        surplusForGovernance = _surplusForGovernance;
    }

    function setSurplusManager(address _surplusManager) external onlyRole(GOVERNOR_ROLE) {
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
        uint256 count = getRoleMemberCount(VAULTMANAGER_ROLE);
        uint256 newSurplus;
        uint256 newBadDebt;
        for (uint256 i = 0; i < count; i++) {
            (newSurplus, newBadDebt) = IVaultManager(getRoleMember(VAULTMANAGER_ROLE, i)).accrueInterestToTreasury();
            surplusBufferValue += newSurplus;
            badDebtValue += newBadDebt;
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
    ) external onlyRole(GOVERNOR_ROLE) {
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
