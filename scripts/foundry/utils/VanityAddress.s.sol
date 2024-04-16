// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

import "stringutils/strings.sol";
import "forge-std/Script.sol";
import { StdAssertions } from "forge-std/Test.sol";
import { stdJson } from "forge-std/StdJson.sol";
import { console } from "forge-std/console.sol";
import { VanityAddress } from "utils/src/VanityAddress.sol";
import "./Constants.s.sol";

contract VanityAddressScript is Script, VanityAddress {
    using stdJson for string;

    string constant JSON_VANITY_PATH = "./scripts/vanity.json";

    using stdJson for string;

    function run() external {
        // Deploy diamond
        bytes
            memory initCode = hex"60406080815262000f5f80380380620000188162000364565b9283398101906060818303126200035f576200003481620003a0565b9160209262000045848401620003a0565b8584015190936001600160401b0391908282116200035f57019280601f850112156200035f57835193620000836200007d86620003b5565b62000364565b94808652878601928882840101116200035f578288620000a49301620003d1565b823b1562000305577f360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc80546001600160a01b03199081166001600160a01b0386811691821790935590959194600093909290917fbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b8580a2805115801590620002fd575b620001f5575b50505050507fb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103937f7e644d79422f17c01e4894b5f4f588d331ebfa28653d42ae832dc59e38c9798f86865493815196818616885216958684820152a18315620001a357501617905551610b0a9081620004558239f35b60849086519062461bcd60e51b82526004820152602660248201527f455243313936373a206e65772061646d696e20697320746865207a65726f206160448201526564647265737360d01b6064820152fd5b8951946060860190811186821017620002e9578a52602785527f416464726573733a206c6f772d6c6576656c2064656c65676174652063616c6c89860152660819985a5b195960ca1b8a860152823b156200029657928092819262000280969551915af43d156200028c573d620002706200007d82620003b5565b9081528092893d92013e620003f6565b5038808080806200012d565b60609150620003f6565b895162461bcd60e51b8152600481018a9052602660248201527f416464726573733a2064656c65676174652063616c6c20746f206e6f6e2d636f6044820152651b9d1c9858dd60d21b6064820152608490fd5b634e487b7160e01b85526041600452602485fd5b508362000127565b865162461bcd60e51b815260048101879052602d60248201527f455243313936373a206e657720696d706c656d656e746174696f6e206973206e60448201526c1bdd08184818dbdb9d1c9858dd609a1b6064820152608490fd5b600080fd5b6040519190601f01601f191682016001600160401b038111838210176200038a57604052565b634e487b7160e01b600052604160045260246000fd5b51906001600160a01b03821682036200035f57565b6001600160401b0381116200038a57601f01601f191660200190565b60005b838110620003e55750506000910152565b8181015183820152602001620003d4565b9091901562000403575090565b815115620004145750805190602001fd5b6044604051809262461bcd60e51b825260206004830152620004468151809281602486015260208686019101620003d1565b601f01601f19168101030190fdfe6080604052600436101561002c575b361561001f575b61001d6104dd565b005b6100276104dd565b610015565b6000803560e01c9081633659cfe614610093575080634f1ef2861461008a5780635c60da1b146100815780638f283970146100785763f851a4400361000e57610073610455565b61000e565b506100736102f0565b5061007361023b565b50610073610157565b3461012c5760207ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc36011261012c576100ca61012f565b73ffffffffffffffffffffffffffffffffffffffff7fb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103541633146000146101235761012090610117610639565b908382526106f3565b80f35b506101206104dd565b80fd5b6004359073ffffffffffffffffffffffffffffffffffffffff8216820361015257565b600080fd5b5060407ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc3601126101525761018a61012f565b60243567ffffffffffffffff9182821161015257366023830112156101525781600401359283116101525736602484840101116101525773ffffffffffffffffffffffffffffffffffffffff7fb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d61035416331460001461023057600060208480602461021e61021961001d996106aa565b610666565b96828852018387013784010152610833565b50505061001d6104dd565b50346101525760007ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc360112610152576020600073ffffffffffffffffffffffffffffffffffffffff90817fb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103541633146000146102e25750807f360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc5416905b60405191168152f35b906102eb6104dd565b6102d9565b50346101525760207ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc3601126101525761032861012f565b73ffffffffffffffffffffffffffffffffffffffff907fb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d610391808354163314600014610230577f7e644d79422f17c01e4894b5f4f588d331ebfa28653d42ae832dc59e38c9798f604084549281519481851686521693846020820152a181156103d1577fffffffffffffffffffffffff000000000000000000000000000000000000000016179055005b60846040517f08c379a000000000000000000000000000000000000000000000000000000000815260206004820152602660248201527f455243313936373a206e65772061646d696e20697320746865207a65726f206160448201527f64647265737300000000000000000000000000000000000000000000000000006064820152fd5b50346101525760007ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc360112610152576020600073ffffffffffffffffffffffffffffffffffffffff7fb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d61038181541633146000146104d85754604051911681529050f35b506102eb5b5073ffffffffffffffffffffffffffffffffffffffff807fb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d61035416331461055f577f360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc54166000808092368280378136915af43d82803e1561055b573d90f35b3d90fd5b60a46040517f08c379a000000000000000000000000000000000000000000000000000000000815260206004820152604260248201527f5472616e73706172656e745570677261646561626c6550726f78793a2061646d60448201527f696e2063616e6e6f742066616c6c6261636b20746f2070726f7879207461726760648201527f65740000000000000000000000000000000000000000000000000000000000006084820152fd5b507f4e487b7100000000000000000000000000000000000000000000000000000000600052604160045260246000fd5b604051906020820182811067ffffffffffffffff82111761065957604052565b610661610609565b604052565b907fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe0601f604051930116820182811067ffffffffffffffff82111761065957604052565b7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe0601f60209267ffffffffffffffff81116106e6575b01160190565b6106ee610609565b6106e0565b803b156107af5773ffffffffffffffffffffffffffffffffffffffff81167f360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc817fffffffffffffffffffffffff00000000000000000000000000000000000000008254161790557fbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b600080a28151158015906107a7575b610792575050565b6107a49161079e6108d9565b91610957565b50565b50600061078a565b60846040517f08c379a000000000000000000000000000000000000000000000000000000000815260206004820152602d60248201527f455243313936373a206e657720696d706c656d656e746174696f6e206973206e60448201527f6f74206120636f6e7472616374000000000000000000000000000000000000006064820152fd5b803b156107af5773ffffffffffffffffffffffffffffffffffffffff81167f360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc817fffffffffffffffffffffffff00000000000000000000000000000000000000008254161790557fbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b600080a28151158015906108d157610792575050565b50600161078a565b604051906060820182811067ffffffffffffffff82111761094a575b604052602782527f206661696c6564000000000000000000000000000000000000000000000000006040837f416464726573733a206c6f772d6c6576656c2064656c65676174652063616c6c60208201520152565b610952610609565b6108f5565b9190823b156109a0576000816109959460208394519201905af43d15610998573d90610985610219836106aa565b9182523d6000602084013e610a24565b90565b606090610a24565b60846040517f08c379a000000000000000000000000000000000000000000000000000000000815260206004820152602660248201527f416464726573733a2064656c65676174652063616c6c20746f206e6f6e2d636f60448201527f6e747261637400000000000000000000000000000000000000000000000000006064820152fd5b90919015610a30575090565b815115610a405750805190602001fd5b604051907f08c379a000000000000000000000000000000000000000000000000000000000825281602080600483015282519283602484015260005b848110610abd575050507fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe0601f836000604480968601015201168101030190fd5b818101830151868201604401528593508201610a7c56fea26469706673582212206eca7257d81e920296a8c93c0ac0d93d9bb0927ce3e4cefa34ff129bc0cdbceb64736f6c634300081100330000000000000000000000000000000000ffe8b47b3e2130213b802212439497000000000000000000000000fda462548ce04282f4b6d6619823a7c64fdc018500000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000000";
        string memory json = vm.readFile(JSON_VANITY_PATH);
        uint256 initInt = json.readUint(string.concat("$.", "init"));
        uint256 iterations = 3000000;

        (address computed, uint256 found) = minePrefix(initCode, DEPLOYER, 0x000020, initInt, iterations);
        console.log("Computed: ", computed);
        console.log("Found: ", found);

        // // write result to json vanity path
        // json = "";
        // vm.serializeUint(json, "init", found);
        // string memory finalJson = vm.serializeAddress(json, "salt", computed);
        // vm.writeFile(JSON_VANITY_PATH, finalJson);
    }
}
