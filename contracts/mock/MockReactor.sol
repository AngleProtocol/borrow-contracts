// SPDX-License-Identifier: AGPL-3.0-only

pragma solidity 0.8.12;

import "../reactor/BaseReactor.sol";

contract MockReactor is BaseReactor {
    uint256 public counter;

    function initialize(
        string memory _name,
        string memory _symbol,
        IVaultManager _vaultManager,
        uint64 _lowerCF,
        uint64 _targetCF,
        uint64 _upperCF
    ) external {
        _initialize(_name, _symbol, _vaultManager, _lowerCF, _targetCF, _upperCF);
    }

    function _pull(uint256 amount) internal override returns (uint256) {
        counter += 1;
        return amount;
    }
}
