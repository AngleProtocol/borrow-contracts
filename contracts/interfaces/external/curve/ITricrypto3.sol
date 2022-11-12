// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

uint256 constant N_COINS = 5;

//solhint-disable
interface ITricrypto3 {
    function calc_token_amount(uint256[N_COINS] memory _amounts, bool _is_deposit) external view returns (uint256);

    function add_liquidity(uint256[N_COINS] memory _amounts, uint256 _min_mint_amount) external returns (uint256);

    function add_liquidity(
        uint256[N_COINS] memory _amounts,
        uint256 _min_mint_amount,
        address _receiver
    ) external returns (uint256);

    function exchange_underlying(
        uint256 i,
        uint256 j,
        uint256 dx,
        uint256 min_dy
    ) external returns (uint256);

    function exchange_underlying(
        uint256 i,
        uint256 j,
        uint256 dx,
        uint256 min_dy,
        address receiver
    ) external returns (uint256);

    function calc_withdraw_one_coin(uint256 _burn_amount, uint256 i) external view returns (uint256);

    function remove_liquidity_one_coin(
        uint256 _burn_amount,
        uint256 i,
        uint256 _min_received
    ) external returns (uint256);

    function remove_liquidity_one_coin(
        uint256 _burn_amount,
        uint256 i,
        uint256 _min_received,
        address receiver
    ) external returns (uint256);

    function remove_liquidity(uint256 _burn_amount, uint256[N_COINS] memory _min_amounts)
        external
        returns (uint256[N_COINS] memory);

    function remove_liquidity(
        uint256 _burn_amount,
        uint256[N_COINS] memory _min_amounts,
        address _receiver
    ) external returns (uint256[N_COINS] memory);
}
