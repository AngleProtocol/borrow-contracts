// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.10;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlEnumerableUpgradeable.sol";

import "../interfaces/ICoreBorrow.sol";
import "../interfaces/IFlashAngle.sol";
import "../interfaces/ITreasury.sol";

/// @title Treasury
/// @author Angle Core Team
/// @notice Treasury of Angle Borrowing Module doing the accounting across all VaultManagers
contract CoreBorrow is ICoreBorrow, Initializable, AccessControlEnumerableUpgradeable {
    /// @notice Role for guardians
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");
    /// @notice Role for governors
    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");
    /// @notice Role for treasury contract
    bytes32 public constant FLASHLOANER_TREASURY_ROLE = keccak256("FLASHLOANER_TREASURY_ROLE");

    uint256 public constant BASE_PARAMS = 10**9;

    address public flashLoanModule;

    function initialize(address governor, address guardian) public initializer {
        require(governor != address(0) && guardian != address(0), "O");
        require(governor != guardian);
        _setupRole(GOVERNOR_ROLE, governor);
        _setupRole(GUARDIAN_ROLE, guardian);
        _setupRole(GUARDIAN_ROLE, governor);
        _setRoleAdmin(GUARDIAN_ROLE, GUARDIAN_ROLE);
        _setRoleAdmin(GOVERNOR_ROLE, GOVERNOR_ROLE);
        _setRoleAdmin(FLASHLOANER_TREASURY_ROLE, GOVERNOR_ROLE);
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() initializer {}

    function isGovernor(address admin) external view override returns (bool) {
        return hasRole(GOVERNOR_ROLE, admin);
    }

    function isGovernorOrGuardian(address admin) external view override returns (bool) {
        return hasRole(GUARDIAN_ROLE, admin);
    }

    function isFlashLoanerTreasury(address treasury) external view override returns (bool) {
        return hasRole(FLASHLOANER_TREASURY_ROLE, treasury);
    }

    function setFlashLoanModule(address _flashLoanModule) external onlyRole(GOVERNOR_ROLE) {
        uint256 count = getRoleMemberCount(FLASHLOANER_TREASURY_ROLE);
        for (uint256 i = 0; i < count; i++) {
            ITreasury(getRoleMember(FLASHLOANER_TREASURY_ROLE, i)).setFlashLoanModule(_flashLoanModule);
        }
        flashLoanModule = _flashLoanModule;
    }

    function addFlashLoanerTreasuryRole(address treasury) external {
        grantRole(FLASHLOANER_TREASURY_ROLE, treasury);
        IFlashAngle(flashLoanModule).addStablecoinSupport(treasury);
    }

    function removeFlashLoanerTreasuryRole(address treasury) external {
        revokeRole(FLASHLOANER_TREASURY_ROLE, treasury);
        IFlashAngle(flashLoanModule).removeStablecoinSupport(treasury);
    }
}
