// SPDX-License-Identifier: MIT
pragma solidity ^0.8.12;

import "./BaseOraclePTPendle.t.sol";

contract OraclePTweETH is BaseOraclePendlePT {
    using stdStorage for StdStorage;

    function setUp() public override {
        super.setUp();

        _TWAP_DURATION = 1 hours;
        _STALE_PERIOD = 24 hours;
        _MAX_IMPLIED_RATE = 0.5 ether;

        vm.selectFork(forkIdentifier[CHAIN_ETHEREUM]);
        _contractTreasury = new MockTreasury(
            IAgToken(address(0)),
            _governor,
            _guardian,
            address(0),
            address(0),
            address(0)
        );
        _oracle = new OraclePTweETHEUR(_STALE_PERIOD, address(_contractTreasury), _MAX_IMPLIED_RATE, _TWAP_DURATION);
        syExchangeRate = IStandardizedYield(_oracle.sy()).exchangeRate();
    }

    /*//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                      CORE LOGIC                                                    
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////*/

    function test_Simple_Success() public {
        assertApproxEqRel(_oracle.read(), 2719 ether, 0.01 ether);
    }

    function test_EconomicalLowerBound_tooSmall() public {
        vm.prank(_governor);
        _oracle.setMaxImpliedRate(uint256(1e1));
        uint256 pendleAMMPrice = PendlePYOracleLib.getPtToAssetRate(IPMarket(_oracle.market()), _TWAP_DURATION);

        assertEq(_oracle.read(), _read(pendleAMMPrice));
    }

    function test_AfterMaturity_Success() public {
        // Adavnce to the PT maturity
        vm.warp(_oracle.maturity());

        // Update the last timestamp oracle push
        _updateChainlinkTimestamp(block.timestamp);

        uint256 pendleAMMPrice = PendlePYOracleLib.getPtToAssetRate(IPMarket(_oracle.market()), _TWAP_DURATION);
        uint256 value = _oracle.read();
        assertEq(value, _read(pendleAMMPrice));
        assertEq(value, _read(1 ether));
    }

    function test_HackRemove_Success(uint256 slash) public {
        slash = bound(slash, 1, BASE_18);
        // Remove part of the SY backing collateral to simulate a hack
        IERC20 weETH = IERC20(address(_oracle.asset()));
        uint256 prevBalance = weETH.balanceOf(_oracle.sy());
        uint256 postBalance = (prevBalance * slash) / BASE_18;
        deal(address(weETH), _oracle.sy(), postBalance);

        uint256 lowerBound = _economicLowerBound(_MAX_IMPLIED_RATE, _oracle.maturity(), BASE_18);
        uint256 value = _oracle.read();

        assertLe(value, _read((lowerBound * slash) / BASE_18));
        if (slash > 0) assertGe(value, _read((lowerBound * (slash - 1)) / BASE_18));
    }

    function test_HackExpand_Success(uint256 expand) public {
        expand = bound(expand, BASE_18, BASE_18 * 1e7);
        // Remove part of the SY backing collateral to simulate a hack
        IERC20 weETH = IERC20(address(_oracle.asset()));
        uint256 prevBalance = weETH.balanceOf(_oracle.sy());
        uint256 postBalance = (prevBalance * expand) / BASE_18;
        deal(address(weETH), _oracle.sy(), postBalance);

        uint256 lowerBound = _economicLowerBound(_MAX_IMPLIED_RATE, _oracle.maturity(), BASE_18);
        uint256 value = _oracle.read();

        assertEq(value, _read((lowerBound)));
    }
}
