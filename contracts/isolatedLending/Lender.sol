// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.8.12;

import "../interfaces/ICoreBorrow.sol";

import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC4626Upgradeable.sol";

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title Lender
/// @author Angle Labs, Inc.
/* TODO
- reentrancy attacks and pulling
*/
contract Lender is ERC4626Upgradeable {
    using MathUpgradeable for uint256;
    using SafeERC20 for IERC20;
    uint256 internal constant _BASE_PARAMS = 10**9;
    uint256 internal constant _BASE = 10**18;

    ICoreBorrow public coreBorrow;

    uint256 public totalDebt;

    mapping(address => uint256) public isBorrower;

    address[] public supportedBorrowList;

    address public surplusManager;

    /// @notice 10**decimals of `asset`
    uint256 internal _assetDecimals;

    /// @notice Checks whether the `msg.sender` has the governor role or not
    modifier onlyGovernor() {
        if (!coreBorrow.isGovernor(msg.sender)) revert NotGovernor();
        _;
    }

    /// @notice Checks whether the `msg.sender` has the governor role or the guardian role
    modifier onlyGovernorOrGuardian() {
        if (!coreBorrow.isGovernorOrGuardian(msg.sender)) revert NotGovernorOrGuardian();
        _;
    }

    modifier onlyBorrower() {
        if (isBorrower[msg.sender] == 0) revert NotBorrower();
        _;
    }

    function initialize(
        ICoreBorrow _coreBorrow,
        address _asset,
        string memory _name,
        string memory _symbol
    ) external initializer {
        __ERC4626_init(IERC20MetadataUpgradeable(_asset));
        __ERC20_init_unchained(
            string(abi.encodePacked("Angle ", _name, " Lender")),
            string(abi.encodePacked("ag-lender-", _symbol))
        );
        if (address(_coreBorrow) == address(0)) revert ZeroAddress();
        _assetDecimals = 10**(IERC20MetadataUpgradeable(_asset).decimals());
        coreBorrow = _coreBorrow;
    }

    function pull(uint256 amount, address to) external onlyBorrower {
        if (to == address(this)) revert InvalidAddress();
        totalDebt += amount;
        IERC20(asset()).safeTransfer(to, amount);
    }

    function push(uint256 amount) external onlyBorrower {
        totalDebt -= amount;
    }

    function distribute(uint256 amountForGovernance, uint256 totalAmount) external onlyBorrower {
        _mint(surplusManager, _convertToShares(amountForGovernance, MathUpgradeable.Rounding.Down));
        totalDebt += totalAmount;
    }

    function totalAssets() public view override returns (uint256) {
        return _getBalance() + totalDebt;
    }

    function _getBalance() internal view returns (uint256) {
        return IERC20(asset()).balanceOf(address(this));
    }

    function maxDeposit(address) public view override returns (uint256) {
        return (totalAssets() != 0 || totalSupply() == 0) ? type(uint256).max : 0;
    }

    /** @dev See {IERC4262-deposit}. */
    function deposit(uint256 assets, address receiver) public virtual override returns (uint256) {
        uint256 shares = previewDeposit(assets);
        _deposit(_msgSender(), receiver, assets, shares);
        return shares;
    }

    /** @dev See {IERC4262-mint}. */
    function mint(uint256 shares, address receiver) public virtual override returns (uint256) {
        uint256 assets = previewMint(shares);
        _deposit(_msgSender(), receiver, assets, shares);

        return assets;
    }

    /** @dev See {IERC4262-withdraw}. */
    function withdraw(
        uint256 assets,
        address receiver,
        address owner
    ) public virtual override returns (uint256) {
        uint256 shares = previewWithdraw(assets);
        _withdraw(_msgSender(), receiver, owner, assets, shares);

        return shares;
    }

    /** @dev See {IERC4262-redeem}. */
    function redeem(
        uint256 shares,
        address receiver,
        address owner
    ) public virtual override returns (uint256) {
        uint256 assets = previewRedeem(shares);
        _withdraw(_msgSender(), receiver, owner, assets, shares);
        return assets;
    }

    /// @dev As stated in the ERC4626 interface, the amount returned is an underestimate of the true max withdrawal amount
    /// as the function to estimate withdrawable assets from strategies underestimates what it can withdraw
    function maxWithdraw(address owner) public view override returns (uint256) {
        return MathUpgradeable.min(_convertToAssets(balanceOf(owner), MathUpgradeable.Rounding.Down), _getBalance());
    }

    /// @dev Like for `maxWithdraw`, this function underestimates the amount of shares `owner` can actually
    /// redeem
    /// @dev If there is not enough in the contract, then the owner can only redeem a certain proportion of its shares:
    /// for instance, if there are only 5 agEUR available and I have 20 shares worth 10 agEUR in the contract,
    /// then my max redemption amount is 10 shares
    function maxRedeem(address owner) public view override returns (uint256 redeemable) {
        return MathUpgradeable.min(balanceOf(owner), _convertToShares(_getBalance(), MathUpgradeable.Rounding.Down));
    }

    /// @dev Since `maxWithdraw` on each strategy should underestimate the amount that can be withdrawn, and since when there are not enough
    /// assets in the contract for the outstanding shares values the function returns `type(uint256).max`, this function effectively
    /// returns an upper bound on the shares that need to be burnt to receive `assets`
    /// @dev The more accurate `maxWithdraw(amount)` is for the strategies in the withdrawal list, the better the bound
    function previewWithdraw(uint256 assets) public view override returns (uint256) {
        if (assets > _getBalance()) return type(uint256).max;
        else return _convertToShares(assets, MathUpgradeable.Rounding.Up);
    }

    /// @dev Computes a lower bound on the assets obtained for burning `shares`
    /// The more accurate `maxWithdraw(amount)` is on each strategies, the better the lower bound
    function previewRedeem(uint256 shares) public view override returns (uint256) {
        uint256 assets = _convertToAssets(shares, MathUpgradeable.Rounding.Down);
        if (assets > _getBalance()) return 0;
        else return assets;
    }

    /// @inheritdoc ERC4626Upgradeable
    function _convertToShares(uint256 assets, MathUpgradeable.Rounding rounding)
        internal
        view
        override
        returns (uint256 shares)
    {
        uint256 supply = totalSupply();
        return
            (assets == 0 || supply == 0)
                ? assets.mulDiv(_BASE, _assetDecimals, rounding)
                : assets.mulDiv(supply, totalAssets(), rounding);
    }

    /// @inheritdoc ERC4626Upgradeable
    function _convertToAssets(uint256 shares, MathUpgradeable.Rounding rounding)
        internal
        view
        override
        returns (uint256 assets)
    {
        uint256 supply = totalSupply();
        return
            (supply == 0)
                ? shares.mulDiv(_assetDecimals, _BASE, rounding)
                : shares.mulDiv(totalAssets(), supply, rounding);
    }

    // =================================== ERRORS ==================================

    error IncompatibleLengths();
    error InvalidAddress();
    error NotGovernor();
    error NotGovernorOrGuardian();
    error NotBorrower();
    error ZeroAddress();

    uint256[44] private __gapLender;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() initializer {}
}
