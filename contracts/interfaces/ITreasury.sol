// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.10;

import "./IAgToken.sol";
import "./IFlashAngle.sol";

interface ITreasury {
    function isVaultManager(address _vaultManager) external view returns (bool);

    function isGovernorOrGuardian(address admin) external view returns (bool);

    function isGovernor(address admin) external view returns (bool);

    function stablecoin() external view returns (IAgToken);

    function setFlashLoanModule(address _flashLoanModule) external;
}
