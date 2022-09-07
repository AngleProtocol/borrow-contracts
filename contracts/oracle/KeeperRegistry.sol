// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../interfaces/ITreasury.sol";
import "../interfaces/IKeeperRegistry.sol";

/// @title KeeperRegistry
/// @notice Maintains a mapping of keepers authorized to use the core module just after oracle updates
/// @author Angle Core Team
contract KeeperRegistry is Initializable, IKeeperRegistry {
    using SafeERC20 for IERC20;

    /// @notice Treasury contract handling access control
    ITreasury public treasury;

    /// @notice Trusted EOAs - needs to be tx.origin
    mapping(address => uint256) public trusted;

    uint256[48] private __gap;

    // ================================== Events ===================================

    event TrustedToggled(address indexed wallet, bool trust);

    // ================================== Errors ===================================

    error NotGovernorOrGuardian();
    error NotTrusted();
    error ZeroAddress();

    // ================================= Modifiers =================================

    /// @notice Checks whether the `msg.sender` has the governor role or the guardian role
    modifier onlyGovernorOrGuardian() {
        if (!treasury.isGovernorOrGuardian(msg.sender)) revert NotGovernorOrGuardian();
        _;
    }

    // ============================ Constructor ====================================

    constructor() initializer {}

    function initialize(ITreasury _treasury) public initializer {
        if (address(_treasury) == address(0)) revert ZeroAddress();
        treasury = _treasury;
    }

    // =========================== Main Function ===================================

    /// @notice Adds or removes a trusted keeper bot
    function toggleTrusted(address eoa) external onlyGovernorOrGuardian {
        uint256 trustedStatus = 1 - trusted[eoa];
        trusted[eoa] = trustedStatus;
        emit TrustedToggled(eoa, trustedStatus == 1);
    }

    /// @inheritdoc IKeeperRegistry
    function isTrusted(address caller) external view returns (bool) {
        return trusted[caller] == 1;
    }
}
