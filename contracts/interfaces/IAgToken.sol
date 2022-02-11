// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.10;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";

/// @title IAgToken
/// @author Angle Core Team
/// @notice Interface for the stablecoins `AgToken` contracts
interface IAgToken is IERC20Upgradeable {
    // ======================= `StableMaster` functions ============================
    function mint(address account, uint256 amount) external;

    function burnFrom(
        uint256 amount,
        address burner,
        address sender
    ) external;

    function burnSelf(uint256 amount, address burner) external;

    function addMinter(address minter) external;

    function removeMinter(address minter) external;

    function isMinter(address minter) external view returns (bool);

    function setTreasury(address _newTreasury) external;

    // ========================= External function =================================

    function stableMaster() external view returns (address);
}
