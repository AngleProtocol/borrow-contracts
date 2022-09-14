// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

/// @title IOracleCore
/// @author Angle Core Team
interface IOracleCore {
    function read() external view returns (uint256);

    function readAll() external view returns (uint256 lowerRate, uint256 upperRate);

    function readLower() external view returns (uint256);

    function readUpper() external view returns (uint256);

    function readQuote(uint256 baseAmount) external view returns (uint256);

    function readQuoteLower(uint256 baseAmount) external view returns (uint256);

    function inBase() external view returns (uint256);
}
