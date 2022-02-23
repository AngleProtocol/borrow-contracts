// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity >=0.8.0;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Minimal IERC4646 tokenized Vault interface.
/// @author Forked from Solmate (https://github.com/Rari-Capital/solmate/blob/main/src/mixins/ERC4626.sol)
/// @dev Do not use in production! ERC-4626 is still in the review stage and is subject to change.
interface IERC4626 {
    event Deposit(address indexed from, address indexed to, uint256 amount, uint256 shares);
    event Withdraw(address indexed from, address indexed to, uint256 amount, uint256 shares);

    /*///////////////////////////////////////////////////////////////
                        DEPOSIT/WITHDRAWAL LOGIC
    //////////////////////////////////////////////////////////////*/

    function deposit(uint256 amount, address to) external returns (uint256 shares);

    function mint(uint256 shares, address to) external returns (uint256 amount);

    function withdraw(
        uint256 amount,
        address to,
        address from
    ) external returns (uint256 shares);

    function redeem(
        uint256 shares,
        address to,
        address from
    ) external returns (uint256 amount);

    /*///////////////////////////////////////////////////////////////
                           ACCOUNTING LOGIC
    //////////////////////////////////////////////////////////////*/

    function totalAssets() external view returns (uint256);

    function assetsOf(address user) external view returns (uint256);

    function assetsPerShare() external view returns (uint256);

    function previewDeposit(uint256 amount) external view returns (uint256);

    function previewMint(uint256 shares) external view returns (uint256);

    function previewWithdraw(uint256 amount) external view returns (uint256);

    function previewRedeem(uint256 shares) external view returns (uint256);

    /*///////////////////////////////////////////////////////////////
                     DEPOSIT/WITHDRAWAL LIMIT LOGIC
    //////////////////////////////////////////////////////////////*/

    function maxDeposit(address) external returns (uint256);

    function maxMint(address) external returns (uint256);

    function maxWithdraw(address user) external returns (uint256);

    function maxRedeem(address user) external returns (uint256);
}
