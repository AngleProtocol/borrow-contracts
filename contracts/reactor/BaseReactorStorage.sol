// SPDX-License-Identifier: AGPL-3.0-only

pragma solidity 0.8.12;

import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/MathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

import "../interfaces/IERC4626.sol";
import "../interfaces/IVaultManager.sol";

contract BaseReactorStorage is Initializable, ReentrancyGuardUpgradeable {
    uint256 public constant BASE_PARAMS = 10**9;

    IERC20 public asset;
    IAgToken public stablecoin;
    IOracle public oracle;
    ITreasury public treasury;
    IVaultManager public vaultManager;
    uint256 public vaultID;

    uint256 public claimableRewards;
    uint256 public currentLoss;

    uint256 public rewardsAccumulator;
    uint256 public claimedRewardsAccumulator;
    uint256 public lastTime;

    mapping(address => uint256) public lastTimeOf;
    mapping(address => uint256) public lastShareOf;
    mapping(address => uint256) public rewardsAccumulatorOf;

    uint64 public lowerCF;
    uint64 public targetCF;
    uint64 public upperCF;

    /// @notice Last known stable debt to the vaultManager
    uint256 public lastDebt;

    bool internal _oracleRateCached;
    uint256 internal _oracleRate;

    uint256[50] private __gap;

    event FiledUint64(uint64 param, bytes32 what);
    event Recovered(address indexed token, address indexed to, uint256 amount);
}
