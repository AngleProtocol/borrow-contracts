// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

//TODO do we still use it or no?
library Errors {
    string public constant ZERO_ADDRESS = "0"; // 'zero address'
    string public constant NOT_GOVERNOR = "1"; // 'sender is not governor'
    string public constant NOT_GOVERNOR_OR_GUARDIAN = "2"; // 'sender is not governor and not guardian'
    string public constant NOT_VAULTMANAGER = "3"; // 'sender is not vaultManager'
    string public constant TOO_BIG_AMOUNT = "4"; // 'too big amount'
    string public constant ALREADY_ADDED_VAULTMANAGER = "5"; // 'vaultManager already added'
    string public constant INVALID_TREASURY = "6"; // 'invalid treasury contract'
    string public constant RIGHTS_NOT_REVOKED = "7"; // 'still has rights over the flash loan contract'
    string public constant RIGHT_NOT_GRANTED = "8"; // 'no right over the flash loan contract'
    string public constant TOO_HIGH_PARAMETER_VALUE = "9"; // 'too high parameter value'
    string public constant NOT_CORE = "10"; // 'sender is not core'
    string public constant INVALID_CORE = "11"; // 'invalid core contract'
    string public constant INCONSISTENT_GOVERNOR_GUARDIAN = "12"; // 'governor must different than guardian'
    string public constant UNSUPPORTED_STABLECOIN = "13"; // 'unsupported stablecoin'
    string public constant NOT_TREASURY = "14"; // 'sender is not treasury'
    string public constant INVALID_PARAMETERS = "15"; // 'invalid set of parameters'
    string public constant UNAPPROVED = "16"; // 'caller not approved'
    string public constant TOO_SMALL_PARAMETER_VALUE = "17"; // 'too small parameter value'
    string public constant INVALID_PARAMETER = "18"; // 'invalid parameter'

    string public constant NOT_WHITELISTED = "20"; // 'not whitelisted'
    string public constant INSOLVENT_VAULT = "21"; // 'insolvent vault'
    string public constant INVALID_VAULTMANAGER = "22"; // 'invalid vaultManager contract'
    string public constant EXCEEDED_DEBT_CEILING = "23"; // 'exceed debt ceiling'
    string public constant DUSTY_DEBT_AMOUNT = "24"; // 'too small debt amount leftover in the vault'
    string public constant INCOMPATIBLE_LENGTHS = "25"; // 'incompatible lengths'
    string public constant NONEXISTENT_VAULT = "26"; // 'nonexistent vault'
    string public constant NO_APPROVAL_TO_OWNER = "27"; // 'approval to owner'
    string public constant NO_APPROVAL_TO_CALLER = "28"; // 'approval to caller'
    string public constant NON_ERC721RECEIVER = "29"; // 'non ERC721Receiver'
    string public constant INCORRECT_CALLER = "30"; // 'incorrect caller'
    string public constant TRANSFER_TO_ZERO_ADDRESS = "31"; // 'transfer to the zero address'

    string public constant INCOMPATIBLE_TREASURY = "33"; // 'not plugged to the same treasury contract'
    string public constant TREASURY_INITIALIZED = "34"; // 'treasury already initialized'
    string public constant NOT_MINTER = "35"; // 'sender is not minter'
    string public constant NOT_ALLOWED_TO_REMOVE_RIGHTS = "36"; // 'invalid sender or target: cannot remove minting rights this way'
    string public constant INVALID_CHAINLINK_RATE = "37"; // 'invalid Chainlink rate'
    string public constant NO_GOVERNOR_LEFT = "38"; // 'not enough governors left'
    string public constant WRONG_RETURN_MESSAGE = "39"; // 'wrong return message'
}
