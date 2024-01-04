// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.17;

import "forge-std/Script.sol";
import { StdAssertions } from "forge-std/Test.sol";
import "stringutils/strings.sol";

contract Utils is Script, StdAssertions {
    using strings for *;

    string constant JSON_SELECTOR_PATH = "./scripts/selectors.json";
    string constant JSON_VANITY_PATH = "./scripts/vanity.json";

    /*//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                        HELPERS                                                     
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////*/

    function _assertArrayUint64(uint64[] memory _a, uint64[] memory _b) internal {
        assertEq(_a.length, _b.length);
        for (uint i = 0; i < _a.length; ++i) {
            assertEq(_a[i], _b[i]);
        }
    }

    function _assertArrayInt64(int64[] memory _a, int64[] memory _b) internal {
        assertEq(_a.length, _b.length);
        for (uint i = 0; i < _a.length; ++i) {
            assertEq(_a[i], _b[i]);
        }
    }

    // return array of function selectors for given facet name
    function _generateSelectors(string memory _facetName) internal returns (bytes4[] memory selectors) {
        console.log("_generateSelectors ", _facetName);
        //get string of contract methods
        string[] memory cmd = new string[](5);
        cmd[0] = "forge";
        cmd[1] = "inspect";
        cmd[2] = "--force";
        cmd[3] = _facetName;
        cmd[4] = "methods";
        bytes memory res = vm.ffi(cmd);
        string memory st = string(res);

        // extract function signatures and take first 4 bytes of keccak
        strings.slice memory s = st.toSlice();
        strings.slice memory delim = ":".toSlice();
        strings.slice memory delim2 = ",".toSlice();
        selectors = new bytes4[]((s.count(delim)));
        for (uint i = 0; i < selectors.length; ++i) {
            s.split('"'.toSlice());
            selectors[i] = bytes4(s.split(delim).until('"'.toSlice()).keccak());
            s.split(delim2);
        }
        return selectors;
    }

    function _bytes4ToBytes32(bytes4 _in) internal pure returns (bytes32 out) {
        assembly {
            out := _in
        }
    }

    function _arrayBytes4ToBytes32(bytes4[] memory _in) internal pure returns (bytes32[] memory out) {
        out = new bytes32[](_in.length);
        for (uint i = 0; i < _in.length; ++i) {
            out[i] = _bytes4ToBytes32(_in[i]);
        }
    }

    function _arrayBytes32ToBytes4(bytes32[] memory _in) internal pure returns (bytes4[] memory out) {
        out = new bytes4[](_in.length);
        for (uint i = 0; i < _in.length; ++i) {
            out[i] = bytes4(_in[i]);
        }
    }

    function consoleLogBytes4Array(bytes4[] memory _in) internal view {
        for (uint i = 0; i < _in.length; ++i) {
            console.logBytes4(_in[i]);
        }
    }
}
