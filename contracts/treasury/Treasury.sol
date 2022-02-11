// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.10;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../interfaces/IAgToken.sol";
import "../interfaces/ICoreBorrow.sol";
import "../interfaces/IFlashAngle.sol";
import "../interfaces/ITreasury.sol";
import "../interfaces/IVaultManager.sol";

/// @title Treasury
/// @author Angle Core Team
/// @notice Treasury of Angle Borrowing Module doing the accounting across all VaultManagers for
/// a given stablecoin
contract Treasury is ITreasury, Initializable {
    using SafeERC20 for IERC20;

    /// @notice Base used for parameter computation
    uint256 public constant BASE_PARAMS = 10**9;

    // =============================== References ==================================

    /// @notice Reference to the Core contract of the module which handles all AccessControl logic
    ICoreBorrow public core;
    /// @notice Flash Loan Module with a minter right on the stablecoin
    IFlashAngle public flashLoanModule;
    /// @inheritdoc ITreasury
    IAgToken public override stablecoin;
    /// @notice Address responsible for handling the surplus made by the treasury
    address public surplusManager;
    /// @notice List of the accepted `VaultManager` of the protocol
    address[] public vaultManagerList;
    /// @notice Maps an address to whether it was initialized as a `VaultManager` contract
    mapping(address => bool) public vaultManagerMap;

    // =============================== Variables ===================================

    /// @notice Amount of bad debt (unbacked stablecoin) accumulated across all `VaultManager` contracts
    /// linked to this stablecoin
    uint256 public badDebt;
    /// @notice Surplus amount accumulated by the contract waiting to be distributed to governance. Technically
    /// only a share of this `surplusBuffer` will go to governance. Once a share of the surplus buffer has been
    /// given to governance, then this surplus is reset
    uint256 public surplusBuffer;

    // =============================== Parameter ===================================

    /// @notice Share of the `surplusBuffer` distributed to governance
    uint64 public surplusForGovernance;

    // =============================== Events ======================================

    event BadDebtUpdated(uint256 badDebtValue);
    event Recovered(address indexed token, address indexed to, uint256 amount);
    event SurplusBufferUpdated(uint256 surplusBufferValue);
    event SurplusForGovernanceUpdated(uint64 _surplusForGovernance);
    event SurplusManagerUpdated(address indexed surplusManager);
    event TreasurySet(address indexed _newTreasury);
    event VaultManagerToggled(address indexed vaultManager);

    // =============================== Modifier ====================================

    /// @notice Checks whether the `msg.sender` has the governor role or not
    modifier onlyGovernor() {
        require(core.isGovernor(msg.sender), "1");
        _;
    }

    /// @notice Initializes the treasury contract
    /// @param _core Address of the `CoreBorrow` contract of the module
    /// @param _stablecoin Address of the stablecoin
    function initialize(ICoreBorrow _core, IAgToken _stablecoin) public initializer {
        require(address(_stablecoin) != address(0) && address(_core) != address(0), "O");
        core = _core;
        stablecoin = _stablecoin;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() initializer {}

    // ========================= View Functions ====================================

    /// @inheritdoc ITreasury
    function isGovernor(address admin) external view override returns (bool) {
        return core.isGovernor(admin);
    }

    /// @inheritdoc ITreasury
    function isGovernorOrGuardian(address admin) external view override returns (bool) {
        return core.isGovernorOrGuardian(admin);
    }

    /// @inheritdoc ITreasury
    function isVaultManager(address _vaultManager) external view override returns (bool) {
        return vaultManagerMap[_vaultManager];
    }

    // ============= External Permissionless Functions =============================

    /// @notice Fetches the surplus accrued across all the `VaultManager` contracts controlled by this
    /// `Treasury` contract as well as from the fees of the `FlashLoan` module
    /// @dev This function pools surplus and bad debt across all contracts and then updates the `surplusBuffer`
    /// (or the `badDebt` if more losses were made than profits)
    function fetchSurplusFromAll() external {
        _fetchSurplusFromAll();
    }

    /// @notice Fetches the surplus accrued in the flash loan module and updates the `surplusBuffer`
    /// @dev This function fails if the `flashLoanModule` has not been initialized yet
    function fetchSurplusFromFlashLoan() external {
        uint256 surplusBufferValue = surplusBuffer + flashLoanModule.accrueInterestToTreasury(stablecoin);
        _updateSurplusBadDebt(surplusBufferValue, badDebt);
    }

    /// @notice Fetches surplus a list of vaultManager contracts
    /// TODO: could be removed or not?
    function fetchSurplusFromVaultManagers(address[] memory vaultManagers) external {
        (uint256 surplusBufferValue, uint256 badDebtValue) = _fetchSurplusFromList(vaultManagers);
        _updateSurplusBadDebt(surplusBufferValue, badDebtValue);
    }

    /// @notice Pushes the surplus buffer to the `surplusManager` contract
    /// @dev This function will fail if the `surplusManager` has not been initialized yet
    /// @dev It makes sure to fetch the surplus from all the contracts handled by this treasury to avoid
    /// the situation where rewards are still distributed to governance even though a `VaultManager` has made
    /// a big loss
    /// @dev Typically this function is to be called once every week by a keeper to distribute rewards to veANGLE
    /// holders
    function pushSurplus() external {
        require(surplusManager != address(0), "0");
        (uint256 surplusBufferValue, ) = _fetchSurplusFromAll();
        surplusBuffer = 0;
        emit SurplusBufferUpdated(0);
        stablecoin.transfer(surplusManager, (surplusForGovernance * surplusBufferValue) / BASE_PARAMS);
    }

    /// @notice Updates the bad debt of the protocol in case where the protocol has accumulated some revenue
    /// from an external source
    /// @param amount Amount to reduce the bad debt of
    /// @dev If the protocol has made a loss and managed to make some profits to recover for this loss (through
    /// a program like Olympus Pro), then this function needs to be called
    /// @dev `badDebt` is simply reduced here by burning stablecoins
    /// @dev It is impossible to burn more than the `badDebt` otherwise this function could be used to manipulate
    /// the `surplusBuffer` and hence the amount going to governance
    function updateBadDebt(uint256 amount) external {
        uint256 badDebtValue = badDebt;
        require(amount <= badDebtValue, "4");
        stablecoin.burnSelf(amount, address(this));
        badDebtValue -= amount;
        badDebt = badDebtValue;
        emit BadDebtUpdated(badDebtValue);
    }

    // ==================== Internal Utility Functions =============================

    /// @notice Internal version of the `fetchSurplusFromAll` function
    function _fetchSurplusFromAll() internal returns (uint256 surplusBufferValue, uint256 badDebtValue) {
        (surplusBufferValue, badDebtValue) = _fetchSurplusFromList(vaultManagerList);
        // It will fail anyway if the `flashLoanModule` is the zero address
        surplusBufferValue += flashLoanModule.accrueInterestToTreasury(stablecoin);
        (surplusBufferValue, badDebtValue) = _updateSurplusBadDebt(surplusBufferValue, badDebtValue);
    }

    /// @notice Fetches the surplus from a list of `VaultManager` addresses without modifying the
    /// `surplusBuffer` and `badDebtValue`
    /// @return surplusBufferValue Value the `surplusBuffer` should have after the call if it was updated
    /// @return badDebtValue Value the `badDebt` should have after the call if it was updated
    /// @dev This internal function is never to be called alone, and should always be called in conjunction
    /// with the `_updateSurplusBadDebt` function
    function _fetchSurplusFromList(address[] memory vaultManagers)
        internal
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
    }

    /// @notice Updates the `surplusBuffer` and the `badDebt` from updated values after calling the flash loan module
    /// and/or a list of `VaultManager` contracts
    /// @param surplusBufferValue Value of the surplus buffer after the calls to the different modules
    /// @param badDebtValue Value of the bad debt after the calls to the different modules
    /// @return Value of the `surplusBuffer` corrected from the `badDebt``
    /// @return Value of the `badDebt` corrected from the `surplusBuffer` and from the surplus the treasury had accumulated
    /// previously
    /// @dev When calling this function, it is possible that there is a positive `surplusBufferValue` and `badDebtValue`,
    /// this function tries to reconcile both values and makes sure that we either have surplus or bad debt but not both
    /// at the same time
    function _updateSurplusBadDebt(uint256 surplusBufferValue, uint256 badDebtValue)
        internal
        returns (uint256, uint256)
    {
        if (badDebtValue > 0) {
            // If we have bad debt we need to burn stablecoins that accrued to the protocol
            // We still need to make sure that we're not burning too much or as much as we can if the debt is big
            uint256 balance = stablecoin.balanceOf(address(this));
            if (balance < badDebtValue) {
                stablecoin.burnSelf(balance, address(this));
                surplusBufferValue = 0;
                badDebtValue -= balance;
            } else {
                stablecoin.burnSelf(badDebtValue, address(this));
                surplusBufferValue = badDebtValue >= surplusBufferValue ? 0 : surplusBufferValue - badDebtValue;
                badDebtValue = 0;
            }
        }
        surplusBuffer = surplusBufferValue;
        badDebt = badDebtValue;
        emit SurplusBufferUpdated(surplusBufferValue);
        emit BadDebtUpdated(badDebtValue);
        return (surplusBufferValue, badDebtValue);
    }

    // ============================ Governor Functions =============================

    /// @notice Adds a new minter for the stablecoin
    /// @param minter Minter address to add
    function addMinter(address minter) external onlyGovernor {
        require(minter != address(0), "0");
        stablecoin.addMinter(minter);
    }

    /// @notice Adds a new `vaultManager`
    /// @param vaultManager `VaultManager` contract to add
    /// @dev This contract should have already been initialized with a correct treasury address
    /// @dev It's this function that gives the minter right to the `vaultManager`
    function addVaultManager(address vaultManager) external onlyGovernor {
        require(!vaultManagerMap[vaultManager], "5");
        require(address(IVaultManager(vaultManager).treasury()) == address(this), "6");
        vaultManagerMap[vaultManager] = true;
        vaultManagerList.push(vaultManager);
        emit VaultManagerToggled(vaultManager);
        stablecoin.addMinter(vaultManager);
    }

    /// @notice Removes a minter from the stablecoin contract
    /// @param minter Minter address to remove
    function removeMinter(address minter) external onlyGovernor {
        // To remove the minter role to a `vaultManager` you have to go through the `removeVaultManager` function
        require(!vaultManagerMap[minter]);
        stablecoin.removeMinter(minter);
    }

    /// @notice Removes a `vaultManager`
    /// @param vaultManager `VaultManager` contract to remove
    /// @dev A removed `vaultManager` loses its minter right on the stablecoin
    function removeVaultManager(address vaultManager) external onlyGovernor {
        require(vaultManagerMap[vaultManager], "3");
        delete vaultManagerMap[vaultManager];
        uint256 vaultManagerListLength = vaultManagerList.length;
        for (uint256 i = 0; i < vaultManagerListLength - 1; i++) {
            if (vaultManagerList[i] == vaultManager) {
                vaultManagerList[i] = vaultManagerList[vaultManagerListLength - 1];
                break;
            }
        }
        vaultManagerList.pop();
        emit VaultManagerToggled(vaultManager);
        stablecoin.removeMinter(vaultManager);
    }

    /// @notice Allows to recover any ERC20 token, including the stablecoin handled by this contract, and to send it
    /// to a contract
    /// @param tokenAddress Address of the token to recover
    /// @param to Address of the contract to send collateral to
    /// @param amountToRecover Amount of collateral to transfer
    /// @dev It is impossible to recover the stablecoin of the protocol if there is some bad debt for it
    /// @dev In this case, the function makes sure to fetch the surplus/bad debt from all the `VaultManager` contracts
    /// and from the flash loan module
    /// @dev If the token to recover is the stablecoin, tokens recovered are fetched
    /// from the surplus and not from the `surplusBuffer`
    function recoverERC20(
        address tokenAddress,
        address to,
        uint256 amountToRecover
    ) external onlyGovernor {
        // Cannot recover stablecoin if badDebt or tap into the surplus buffer
        if (tokenAddress == address(stablecoin)) {
            _fetchSurplusFromAll();
            // If balance is non zero then this means, after the call to `fetchSurplusFromAll` that
            // bad debt is necessarily null
            uint256 balance = stablecoin.balanceOf(address(this));
            require(amountToRecover + surplusBuffer <= balance);
            stablecoin.transfer(to, amountToRecover);
        } else {
            IERC20(tokenAddress).safeTransfer(to, amountToRecover);
        }
        emit Recovered(tokenAddress, to, amountToRecover);
    }

    /// @notice Changes the treasury contract and communicates this change to all `VaultManager` contract
    /// @param _newTreasury New treasury address for this stablecoin
    /// @dev This function is basically a way to remove rights to this contract and grant them to a new one
    function setTreasury(address _newTreasury) external onlyGovernor {
        require(_newTreasury != address(0), "0");
        // TODO: not checking that it's the same stablecoin otherwise it would prevent us from setting some custom params
        // but do we really want it?
        // Flash loan role should be removed before calling this function
        require(!core.isFlashLoanerTreasury(_newTreasury), "7");
        emit TreasurySet(_newTreasury);
        for (uint256 i = 0; i < vaultManagerList.length; i++) {
            IVaultManager(vaultManagerList[i]).setTreasury(_newTreasury);
        }
        stablecoin.setTreasury(_newTreasury);
    }

    /// @notice Sets the `surplusForGovernance` parameter
    /// @param _surplusForGovernance New value of the parameter
    function setSurplusForGovernance(uint64 _surplusForGovernance) external onlyGovernor {
        require(_surplusForGovernance <= BASE_PARAMS, "9");
        surplusForGovernance = _surplusForGovernance;
        emit SurplusForGovernanceUpdated(_surplusForGovernance);
    }

    /// @notice Sets the `surplusManager` contract responsible for handling the surplus of the
    /// protocol
    /// @param _surplusManager New address responsible for handling the surplus
    function setSurplusManager(address _surplusManager) external onlyGovernor {
        require(surplusManager != address(0), "0");
        surplusManager = _surplusManager;
        emit SurplusManagerUpdated(_surplusManager);
    }

    /// @inheritdoc ITreasury
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
}
