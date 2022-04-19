// SPDX-License-Identifier: GNU-3

pragma solidity 0.8.12;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./RevertReasonParser.sol";

import "hardhat/console.sol";

/*
Inspired from DeFiSaver `TaskExecutor` https://etherscan.io/address/0xb3e5371d55e1e84bffe7d0b57bd9c6a4c6b3c635
and adapted to our needs:
    - adapted the multicall to be able to call the DsProxyMulticallTarget in order to avoid deploying multiple contracts
    - added the ability to pay the miner (for private Flashbots transactions)
    - swap tokens through 1inch
*/
contract KeeperMulticall is Initializable, OwnableUpgradeable {
    using SafeERC20 for IERC20;

    address private constant _oneInch = 0x1111111254fb6c44bAC0beD2854e76F90643097d;

    struct Action {
        address target;
        bytes data;
        bool isDelegateCall;
    }

    event LogAction(address indexed target, bytes data);
    event SentToMiner(uint256 indexed value);
    event Recovered(address indexed tokenAddress, address indexed to, uint256 amount);

    error InvalidLength();
    error ZeroAddress();
    error AmountOutTooLow(uint256 amount, uint256 min);
    error BalanceTooLow();
    error RevertBytes();
    error FlashbotsErrorPayingMiner(uint256 value);

    constructor() initializer {}

    function initialize() public initializer {
        __Ownable_init();
    }

    /// @notice Called directly through DsProxy to execute a task
    /// @dev This is the main entry point for Recipes/Tasks executed manually
    /// @param actions Actions to be executed
    /// @param percentageToMiner Percentage to pay to miner expressed in bps (10000)
    function executeActions(Action[] memory actions, uint256 percentageToMiner)
        external
        payable
        onlyOwner
        returns (bytes[] memory)
    {
        uint256 numberOfActions = actions.length;
        if (numberOfActions == 0) revert InvalidLength();

        bytes[] memory returnValues = new bytes[](numberOfActions + 1);

        uint256 balanceBefore = address(this).balance;

        for (uint256 i = 0; i < numberOfActions; ++i) {
            returnValues[i] = _executeAction(actions[i]);
        }

        if (percentageToMiner > 0) {
            uint256 balanceAfter = address(this).balance;
            if (balanceAfter > balanceBefore) {
                uint256 amountToMiner = ((balanceAfter - balanceBefore) * percentageToMiner) / 10000;
                returnValues[numberOfActions] = payFlashbots(amountToMiner);
            }
        }

        return returnValues;
    }

    /// @notice Gets the action address and data and executes it
    /// @param action Action to be executed
    function _executeAction(Action memory action) internal returns (bytes memory) {
        bool success;
        bytes memory response;

        // if (action.target == address(this)) {
        if (action.isDelegateCall) {
            (success, response) = action.target.delegatecall(action.data);
        } else {
            (success, response) = action.target.call(action.data);
        }

        require(success, RevertReasonParser.parse(response, "action reverted: "));
        emit LogAction(action.target, action.data);
        return response;
    }

    /// @notice Ability to pay miner directly. Used for Flashbots to execute private transactions
    /// @param value Value to be sent
    function payFlashbots(uint256 value) public payable onlyOwner returns (bytes memory) {
        (bool success, bytes memory response) = block.coinbase.call{ value: value }("");
        if (!success) revert FlashbotsErrorPayingMiner(value);
        emit SentToMiner(value);
        return response;
    }

    function finalBalanceCheck(IERC20[] memory tokens, uint256[] memory minBalances) external returns (bool) {
        uint256 tokensLength = tokens.length;
        if (tokensLength == 0 || tokensLength != minBalances.length) revert InvalidLength();

        for (uint256 i; i < tokensLength; ++i) {
            if (address(tokens[i]) == 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE) {
                if (address(this).balance < minBalances[i]) revert BalanceTooLow();
            } else {
                if (tokens[i].balanceOf(address(this)) < minBalances[i]) revert BalanceTooLow();
            }
        }

        return true;
    }

    /// @notice Swap token to ETH through 1Inch
    /// @param minAmountOut Minimum amount of ETH to receive for the swap to happen
    /// @param payload Bytes needed for 1Inch API
    function swapToken(uint256 minAmountOut, bytes memory payload) external onlyOwner {
        (bool success, bytes memory result) = _oneInch.call(payload);
        if (!success) _revertBytes(result);

        uint256 amountOut = abi.decode(result, (uint256));
        if (amountOut < minAmountOut) revert AmountOutTooLow(amountOut, minAmountOut);
    }

    /// @notice Approve a `spender` for `token`
    /// @param token Address of the token to approve
    /// @param spender Address of the spender to approve
    /// @param amount Amount to approve
    function approve(
        IERC20 token,
        address spender,
        uint256 amount
    ) external onlyOwner {
        token.approve(spender, amount);
    }

    function _revertBytes(bytes memory errMsg) internal pure {
        if (errMsg.length > 0) {
            //solhint-disable-next-line
            assembly {
                revert(add(32, errMsg), mload(errMsg))
            }
        }
        revert RevertBytes();
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

        emit Recovered(_token, _receiver, _amount);
    }

    /// @notice Destroy the contract
    /// In case there is an issue with this implementation
    /// we can kill it to make sure we don't call it again accidentally
    function kill() external onlyOwner {
        selfdestruct(payable(msg.sender));
    }
}
