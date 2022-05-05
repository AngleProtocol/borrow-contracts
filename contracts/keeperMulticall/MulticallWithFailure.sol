// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

contract MultiCallWithFailure {
    struct Call {
        address target;
        bytes data;
        bool canFail;
    }

    function multiCall(Call[] memory calls) external view returns (bytes[] memory) {
        bytes[] memory results = new bytes[](calls.length);

        for (uint256 i; i < calls.length; i++) {
            (bool success, bytes memory result) = calls[i].target.staticcall(calls[i].data);
            if (!calls[i].canFail) require(success, "call failed");
            results[i] = result;
        }

        return results;
    }
}
