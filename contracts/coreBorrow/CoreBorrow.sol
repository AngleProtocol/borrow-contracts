// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.10;

import "@openzeppelin/contracts-upgradeable/access/AccessControlEnumerableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import "../interfaces/ICoreBorrow.sol";
import "../interfaces/IFlashAngle.sol";
import "../interfaces/ITreasury.sol";

/// @title CoreBorrow
/// @author Angle Core Team
/// @notice Core contract of the borrowing module. This contract handles the access control across all contracts
/// (it is read by all treasury contracts), and manages the `flashLoanModule`. It has no minting rights over the
/// stablecoin contracts
contract CoreBorrow is ICoreBorrow, Initializable, AccessControlEnumerableUpgradeable {
    /// @notice Role for guardians
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");
    /// @notice Role for governors
    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");
    /// @notice Role for treasury contract
    bytes32 public constant FLASHLOANER_TREASURY_ROLE = keccak256("FLASHLOANER_TREASURY_ROLE");

    // ============================= Reference =====================================

    /// @notice Reference to the `flashLoanModule` with minting rights over the different stablecoins of the protocol
    address public flashLoanModule;

    // =============================== Event =======================================

    event FlashLoanModuleUpdated(address indexed _flashloanModule);

    /// @notice Initializes the `CoreBorrow` contract and the access control of the borrowing module
    /// @param governor Address of the governor of the Angle Protocol
    /// @param guardian Guardian address of the protocol
    function initialize(address governor, address guardian) public initializer {
        require(governor != address(0) && guardian != address(0), "O");
        require(governor != guardian, "12");
        _setupRole(GOVERNOR_ROLE, governor);
        _setupRole(GUARDIAN_ROLE, guardian);
        _setupRole(GUARDIAN_ROLE, governor);
        _setRoleAdmin(GUARDIAN_ROLE, GUARDIAN_ROLE);
        _setRoleAdmin(GOVERNOR_ROLE, GOVERNOR_ROLE);
        _setRoleAdmin(FLASHLOANER_TREASURY_ROLE, GOVERNOR_ROLE);
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() initializer {}

    // =========================== View Functions ==================================

    /// @inheritdoc ICoreBorrow
    function isFlashLoanerTreasury(address treasury) external view override returns (bool) {
        return hasRole(FLASHLOANER_TREASURY_ROLE, treasury);
    }

    /// @inheritdoc ICoreBorrow
    function isGovernor(address admin) external view override returns (bool) {
        return hasRole(GOVERNOR_ROLE, admin);
    }

    /// @inheritdoc ICoreBorrow
    function isGovernorOrGuardian(address admin) external view override returns (bool) {
        return hasRole(GUARDIAN_ROLE, admin);
    }

    // =========================== Governor Functions ==============================

    /// @notice Grants the `FLASHLOANER_TREASURY_ROLE` to a `treasury` contract
    /// @param treasury Contract to grant the role to
    /// @dev This function can be used to allow flash loans on a stablecoin of the protocol
    function addFlashLoanerTreasuryRole(address treasury) external {
        address _flashLoanModule = flashLoanModule;
        grantRole(FLASHLOANER_TREASURY_ROLE, treasury);
        // This call will revert if `treasury` is the zero address or if it is not linked
        // to this `CoreBorrow` contract
        ITreasury(treasury).setFlashLoanModule(_flashLoanModule);
        IFlashAngle(_flashLoanModule).addStablecoinSupport(treasury);
    }

    /// @notice Adds a governor in the protocol
    /// @param governor Address to grant the role to
    /// @dev It is necessary to call this function to grant a governor role to make sure
    /// all governors also have the guardian role
    function addGovernor(address governor) external {
        grantRole(GOVERNOR_ROLE, governor);
        grantRole(GUARDIAN_ROLE, governor);
    }

    /// @notice Revokes the flash loan ability for a stablecoin
    /// @param treasury Treasury address associated with the stablecoin for which flash loans
    /// should no longer be available
    function removeFlashLoanerTreasuryRole(address treasury) external {
        revokeRole(FLASHLOANER_TREASURY_ROLE, treasury);
        ITreasury(treasury).setFlashLoanModule(address(0));
        IFlashAngle(flashLoanModule).removeStablecoinSupport(treasury);
    }

    /// @notice Revokes a governor from the protocol
    /// @param governor Address to remove the role to
    /// @dev It is necessary to call this function to remove a governor role to make sure
    /// the address also loses its guardian role
    function removeGovernor(address governor) external {
        revokeRole(GOVERNOR_ROLE, governor);
        revokeRole(GUARDIAN_ROLE, governor);
    }

    /// @notice Changes the `flashLoanModule` of the protocol
    /// @param _flashLoanModule Address of the new flash loan module
    function setFlashLoanModule(address _flashLoanModule) external onlyRole(GOVERNOR_ROLE) {
        require(address(IFlashAngle(_flashLoanModule).core()) == address(this), "11");
        uint256 count = getRoleMemberCount(FLASHLOANER_TREASURY_ROLE);
        for (uint256 i = 0; i < count; i++) {
            ITreasury(getRoleMember(FLASHLOANER_TREASURY_ROLE, i)).setFlashLoanModule(_flashLoanModule);
        }
        flashLoanModule = _flashLoanModule;
        emit FlashLoanModuleUpdated(_flashLoanModule);
    }
}
