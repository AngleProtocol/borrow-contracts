// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import { stdStorage, StdStorage } from "forge-std/Test.sol";
import "../BaseTest.test.sol";
import "../../../contracts/mock/MockTreasury.sol";
import { IAgToken, AgToken } from "../../../contracts/agToken/AgToken.sol";

contract AgTokenTest is BaseTest {
    using stdStorage for StdStorage;

    address internal _hacker = address(uint160(uint256(keccak256(abi.encodePacked("hacker")))));

    AgToken internal _agToken;
    MockTreasury internal _treasury;

    string constant _NAME = "Angle stablecoin gold";
    string constant _SYMBOL = "agGold";

    function setUp() public override {
        super.setUp();

        AgToken _agTokenImplem = new AgToken();
        bytes memory emptyData;
        _agToken = AgToken(deployUpgradeable(address(_agTokenImplem), emptyData));

        _treasury = new MockTreasury(
            IAgToken(address(_agToken)),
            _GOVERNOR,
            _GUARDIAN,
            address(0),
            address(0),
            address(0)
        );

        _agToken.initialize(_NAME, _SYMBOL, address(_treasury));

        vm.prank(_GOVERNOR);
        _treasury.setStablecoin(_agToken);
    }

    // ================================= INITIALIZE ================================

    function testConstructor() public {
        assertEq(_agToken.name(), _NAME);
        assertEq(_agToken.symbol(), _SYMBOL);
        assertEq(_agToken.decimals(), 18);
        assertEq(_agToken.treasury(), address(_treasury));
    }

    function testAlreadyInitalizeFail() public {
        string memory name2 = "Angle stablecoin XXX";
        string memory symbol2 = "agXXX";
        vm.expectRevert();
        _agToken.initialize(name2, symbol2, _alice);

        assertEq(_agToken.name(), _NAME);
        assertEq(_agToken.symbol(), _SYMBOL);
        assertEq(_agToken.decimals(), 18);
        assertEq(_agToken.treasury(), address(_treasury));
    }
}
