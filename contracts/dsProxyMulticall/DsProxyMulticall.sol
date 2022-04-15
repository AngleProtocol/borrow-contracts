// SPDX-License-Identifier: GNU-3
// proxy.sol - execute actions atomically through the proxy's identity

// Copyright (C) 2017  DappHub, LLC

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

pragma solidity 0.8.12;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "hardhat/console.sol";

// https://etherscan.io/address/0xb3e5371d55e1e84bffe7d0b57bd9c6a4c6b3c635#code
contract DsProxyMulticallTarget is Ownable {
    using SafeERC20 for IERC20;

    address private constant _oneInch =
        0x1111111254fb6c44bAC0beD2854e76F90643097d;

    struct Action {
        address _target;
        bytes _data;
        bool isCallingItself;
    }

    /// @notice Called directly through DsProxy to execute a task
    /// @dev This is the main entry point for Recipes/Tasks executed manually
    /// @param actions Actions to be executed
    /// @param percentageToMiner Percentage to pay to miner expressed in bps (10000)
    function executeActions(
        Action[] memory actions,
        uint256 percentageToMiner,
        address receiver
    ) external payable returns (bytes[] memory) {
        uint256 numberOfActions = actions.length;
        require(numberOfActions != 0, "wrong length");

        bytes[] memory returnValues = new bytes[](numberOfActions + 1);

        uint256 balanceBefore = address(this).balance;

        for (uint256 i = 0; i < numberOfActions; ++i) {
            returnValues[i] = _executeAction(actions, i, returnValues);
        }

        if (percentageToMiner > 0) {
            uint256 balanceAfter = address(this).balance;
            if (balanceAfter > balanceBefore) {
                uint256 amountToMiner = ((balanceAfter - balanceBefore) *
                    percentageToMiner) / 10000;
                returnValues[numberOfActions] = payFlashbots(
                    amountToMiner,
                    receiver
                );
            }
        }

        return returnValues;
    }

    /// @notice Gets the action address and executes it
    /// @param actions Actions to be executed
    /// @param _index Index of the action in the task array
    /// @param _returnValues Return values from previous actions
    function _executeAction(
        Action[] memory actions,
        uint256 _index,
        bytes[] memory _returnValues
    ) internal returns (bytes memory) {
        bool success;
        bytes memory response;

        if (actions[_index].isCallingItself) {
            (success, response) = actions[_index]._target.delegatecall(
                actions[_index]._data
            );
        } else {
            (success, response) = actions[_index]._target.call(
                actions[_index]._data
            );
        }

        require(
            success,
            RevertReasonParser.parse(response, "action reverted: ")
        );
        return response;
    }

    function payFlashbots(uint256 value, address receiver)
        public
        payable
        returns (bytes memory)
    {
        // (bool success, bytes memory response) = block.coinbase.call{value: value}("");

        console.log("balance", address(this).balance);
        console.log("value  ", value);
        (bool success, bytes memory response) = receiver.call{value: value}("");
        require(success, "error paying miner");
        console.log("PAY FLASHBOTS", value);
        return response;
    }

    /// @notice Swap token to ETH through 1Inch
    /// @param minAmountOut Minimum amount of ETH to receive for the swap to happen
    /// @param payload Bytes needed for 1Inch API
    function swapToken(uint256 minAmountOut, bytes memory payload) external {
        (bool success, bytes memory result) = _oneInch.call(payload);
        if (!success) _revertBytes(result);

        uint256 amountOut = abi.decode(result, (uint256));
        require(amountOut >= minAmountOut, "amountOut too low");
    }

    function approve(
        IERC20 token,
        address spender,
        uint256 amount
    ) external {
        token.approve(spender, amount);
    }

    function _revertBytes(bytes memory errMsg) internal pure {
        if (errMsg.length > 0) {
            //solhint-disable-next-line
            assembly {
                revert(add(32, errMsg), mload(errMsg))
            }
        }
        revert("_revertBytes");
    }

    function checkConditionsOrRevert() external pure returns (uint256) {
        return 0;
    }

    receive() external payable {}

    /// @notice withdraw stuck funds
    function withdrawStuckFunds(
        address _token,
        address _receiver,
        uint256 _amount
    ) external onlyOwner {
        if (_token == 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE) {
            payable(_receiver).transfer(_amount);
        } else {
            IERC20(_token).safeTransfer(_receiver, _amount);
        }
    }

    /// @notice Destroy the contract
    /// In case there is an issue with this implementation
    /// we can kill it to make sure we don't call it again accidentally
    function kill() external onlyOwner {
        selfdestruct(payable(msg.sender));
    }
}

library RevertReasonParser {
    bytes4 private constant _PANIC_SELECTOR =
        bytes4(keccak256("Panic(uint256)"));
    bytes4 private constant _ERROR_SELECTOR =
        bytes4(keccak256("Error(string)"));

    function parse(bytes memory data, string memory prefix)
        internal
        pure
        returns (string memory)
    {
        if (data.length >= 4) {
            bytes4 selector;
            assembly {
                // solhint-disable-line no-inline-assembly
                selector := mload(add(data, 0x20))
            }

            // 68 = 4-byte selector + 32 bytes offset + 32 bytes length
            if (selector == _ERROR_SELECTOR && data.length >= 68) {
                uint256 offset;
                bytes memory reason;
                // solhint-disable no-inline-assembly
                assembly {
                    // 36 = 32 bytes data length + 4-byte selector
                    offset := mload(add(data, 36))
                    reason := add(data, add(36, offset))
                }
                /*
                    revert reason is padded up to 32 bytes with ABI encoder: Error(string)
                    also sometimes there is extra 32 bytes of zeros padded in the end:
                    https://github.com/ethereum/solidity/issues/10170
                    because of that we can't check for equality and instead check
                    that offset + string length + extra 36 bytes is less than overall data length
                */
                require(
                    data.length >= 36 + offset + reason.length,
                    "Invalid revert reason"
                );
                return string(abi.encodePacked(prefix, "Error(", reason, ")"));
            }
            // 36 = 4-byte selector + 32 bytes integer
            else if (selector == _PANIC_SELECTOR && data.length == 36) {
                uint256 code;
                // solhint-disable no-inline-assembly
                assembly {
                    // 36 = 32 bytes data length + 4-byte selector
                    code := mload(add(data, 36))
                }
                return
                    string(
                        abi.encodePacked(prefix, "Panic(", _toHex(code), ")")
                    );
            }
        }

        return string(abi.encodePacked(prefix, "Unknown(", _toHex(data), ")"));
    }

    function _toHex(uint256 value) private pure returns (string memory) {
        return _toHex(abi.encodePacked(value));
    }

    function _toHex(bytes memory data) private pure returns (string memory) {
        bytes16 alphabet = 0x30313233343536373839616263646566;
        bytes memory str = new bytes(2 + data.length * 2);
        str[0] = "0";
        str[1] = "x";
        for (uint256 i = 0; i < data.length; i++) {
            str[2 * i + 2] = alphabet[uint8(data[i] >> 4)];
            str[2 * i + 3] = alphabet[uint8(data[i] & 0x0f)];
        }
        return string(str);
    }
}

// TODO: TO DELETE

interface DSAuthority {
    function canCall(
        address src,
        address dst,
        bytes4 sig
    ) external view returns (bool);
}

contract DSAuthEvents {
    event LogSetAuthority(address indexed authority);
    event LogSetOwner(address indexed owner);
}

contract DSAuth is DSAuthEvents {
    DSAuthority public authority;
    address public owner;

    constructor() {
        owner = msg.sender;
        emit LogSetOwner(msg.sender);
    }

    function setOwner(address owner_) public auth {
        owner = owner_;
        emit LogSetOwner(owner);
    }

    function setAuthority(DSAuthority authority_) public auth {
        authority = authority_;
        emit LogSetAuthority(address(authority));
    }

    modifier auth() {
        require(isAuthorized(msg.sender, msg.sig), "ds-auth-unauthorized");
        _;
    }

    function isAuthorized(address src, bytes4 sig)
        internal
        view
        returns (bool)
    {
        if (src == address(this)) {
            return true;
        } else if (src == owner) {
            return true;
        } else if (authority == DSAuthority(address(0))) {
            return false;
        } else {
            return authority.canCall(src, address(this), sig);
        }
    }
}

contract DSNote {
    event LogNote(
        bytes4 indexed sig,
        address indexed guy,
        bytes32 indexed foo,
        bytes32 indexed bar,
        uint256 wad,
        bytes fax
    ) anonymous;

    modifier note() {
        bytes32 foo;
        bytes32 bar;
        uint256 wad;

        assembly {
            foo := calldataload(4)
            bar := calldataload(36)
            wad := callvalue()
        }

        _;

        emit LogNote(msg.sig, msg.sender, foo, bar, wad, msg.data);
    }
}

// DSProxy
// Allows code execution using a persistant identity This can be very
// useful to execute a sequence of atomic actions. Since the owner of
// the proxy can be changed, this allows for dynamic ownership models
// i.e. a multisig
contract DSProxy is DSAuth, DSNote {
    DSProxyCache public cache; // global cache for contracts

    constructor(address _cacheAddr) {
        setCache(_cacheAddr);
    }

    receive() external payable {}

    // use the proxy to execute calldata _data on contract _code
    function execute(bytes memory _code, bytes memory _data)
        public
        payable
        returns (address target, bytes memory response)
    {
        target = cache.read(_code);
        if (target == address(0)) {
            // deploy contract & store its address in cache
            target = cache.write(_code);
        }

        response = execute(target, _data);
    }

    function execute(address _target, bytes memory _data)
        public
        payable
        auth
        note
        returns (bytes memory response)
    {
        require(_target != address(0), "ds-proxy-target-address-required");

        // console.log("DSPROXY");
        // console.logAddress(_target);
        // console.logBytes(_data);
        // console.log("------");

        // call contract in current context
        assembly {
            let succeeded := delegatecall(
                sub(gas(), 5000),
                _target,
                add(_data, 0x20),
                mload(_data),
                0,
                0
            )
            let size := returndatasize()

            response := mload(0x40)
            mstore(
                0x40,
                add(response, and(add(add(size, 0x20), 0x1f), not(0x1f)))
            )
            mstore(response, size)
            returndatacopy(add(response, 0x20), 0, size)

            switch iszero(succeeded)
            case 1 {
                // throw if delegatecall failed
                revert(add(response, 0x20), size)
            }
        }
    }

    //set new cache
    function setCache(address _cacheAddr) public auth note returns (bool) {
        require(_cacheAddr != address(0), "ds-proxy-cache-address-required");
        cache = DSProxyCache(_cacheAddr); // overwrite cache
        return true;
    }
}

// DSProxyFactory
// This factory deploys new proxy instances through build()
// Deployed proxy addresses are logged
contract DSProxyFactory {
    event Created(
        address indexed sender,
        address indexed owner,
        address proxy,
        address cache
    );
    mapping(address => bool) public isProxy;
    DSProxyCache public cache;

    constructor() {
        cache = new DSProxyCache();
    }

    // deploys a new proxy instance
    // sets owner of proxy to caller
    function build() public returns (address payable proxy) {
        proxy = build(msg.sender);
    }

    // deploys a new proxy instance
    // sets custom owner of proxy
    function build(address owner) public returns (address payable proxy) {
        proxy = payable(address(new DSProxy(address(cache))));
        emit Created(msg.sender, owner, address(proxy), address(cache));
        DSProxy(proxy).setOwner(owner);
        isProxy[proxy] = true;
    }
}

// DSProxyCache
// This global cache stores addresses of contracts previously deployed
// by a proxy. This saves gas from repeat deployment of the same
// contracts and eliminates blockchain bloat.

// By default, all proxies deployed from the same factory store
// contracts in the same cache. The cache a proxy instance uses can be
// changed.  The cache uses the sha3 hash of a contract's bytecode to
// lookup the address
contract DSProxyCache {
    mapping(bytes32 => address) cache;

    function read(bytes memory _code) public view returns (address) {
        bytes32 hash = keccak256(_code);
        return cache[hash];
    }

    function write(bytes memory _code) public returns (address target) {
        assembly {
            target := create(0, add(_code, 0x20), mload(_code))
            switch iszero(extcodesize(target))
            case 1 {
                // throw if contract failed to deploy
                revert(0, 0)
            }
        }
        bytes32 hash = keccak256(_code);
        cache[hash] = target;
    }
}
