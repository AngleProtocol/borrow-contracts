// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.19;

import { IAccessControlManager } from "../interfaces/IAccessControlManager.sol";

import "./Errors.sol";

/// @title AccessControl
/// @author Angle Labs, Inc.
contract AccessControl {
    /// @notice `accessControlManager` used to check roles
    IAccessControlManager public accessControlManager;

    /// @notice Initializes the immutable variables of the contract `accessControlManager`
    constructor(IAccessControlManager _accessControlManager) {
        if (address(_accessControlManager) == address(0)) revert ZeroAddress();
        accessControlManager = _accessControlManager;
    }

    /*//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                       MODIFIERS                                                    
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////*/

    /// @notice Checks whether the `msg.sender` has the governor role
    modifier onlyGovernor() {
        if (!accessControlManager.isGovernor(msg.sender)) revert NotGovernor();
        _;
    }

    /// @notice Checks whether the `msg.sender` has the guardian role
    modifier onlyGovernorOrGuardian() virtual {
        if (!accessControlManager.isGovernorOrGuardian(msg.sender)) revert NotGovernorOrGuardian();
        _;
    }

    /*//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                       FUNCTIONS                                                    
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////*/

    /// @notice Checks whether `admin` has the governor role
    function isGovernor(address admin) external view returns (bool) {
        return accessControlManager.isGovernor(admin);
    }

    /// @notice Checks whether `admin` has the guardian role
    function isGovernorOrGuardian(address admin) external view returns (bool) {
        return accessControlManager.isGovernorOrGuardian(admin);
    }
}
