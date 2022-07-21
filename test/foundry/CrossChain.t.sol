// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import { console } from "forge-std/console.sol";
import { Test } from "forge-std/Test.sol";

import "../../contracts/agToken/layerZero/LayerZeroBridgeToken.sol";
import "../../contracts/agToken/layerZero/LayerZeroBridge.sol";
import "../../contracts/agToken/AgTokenSideChainMultiBridge.sol";

import "../../contracts/treasury/Treasury.sol";
import "../../contracts/mock/MockStableMaster.sol";
import "../../contracts/mock/MockOracle.sol";
import "../../contracts/mock/MockToken.sol";
import "../../contracts/coreBorrow/CoreBorrow.sol";
import "../../contracts/agToken/AgToken.sol";

contract CrossChainTest is Test {
    uint256 private _ethereum;
    uint256 private _polygon;
    uint256 private _fantom;

    address payable private _sender = payable(address(uint160(uint256(keccak256(abi.encodePacked("sender"))))));
    address private _receiver = address(uint160(uint256(keccak256(abi.encodePacked("receiver")))));

    address internal _user = address(uint160(uint256(keccak256(abi.encodePacked("user")))));

    address internal _remote = address(uint160(uint256(keccak256(abi.encodePacked("remote")))));

    address internal _governor = address(uint160(uint256(keccak256(abi.encodePacked("governor")))));
    address internal _guardian = address(uint160(uint256(keccak256(abi.encodePacked("guardian")))));

    MockStableMaster internal _contractStableMaster;
    CoreBorrow internal _contractCoreBorrow;
    Treasury internal _contractTreasury;
    AgToken internal _contractAgToken;

    MockToken internal _collateral;
    MockOracle internal _oracle;

    LayerZeroBridge internal _layerZeroBridge;
    LayerZeroBridgeToken internal _layerZeroBridgeToken;
    AgTokenSideChainMultiBridge internal _agTokenSideChainMultiBridge;

    MockToken internal _mockToken;

    struct LZAddresses {
        address endpoint;
        uint256 chainId;
        uint16 lzChainId;
    }
    mapping(string => LZAddresses) internal _lzAddressesPerChain;

    function setUp() public virtual {
        _ethereum = vm.createFork("https://eth-mainnet.alchemyapi.io/v2/K-M3e0cpvugLUuCkoKT6uKmlkB0ccBV2");
        _polygon = vm.createFork("https://polygon-mainnet.g.alchemy.com/v2/IJTj5SikhXCIV_a021XV2xpbLL8ibwUP");
        _fantom = vm.createFork("https://rpc.ftm.tools");

        _lzAddressesPerChain["ethereum"] = LZAddresses({
            endpoint: 0x66A71Dcef29A0fFBDBE3c6a460a3B5BC225Cd675,
            chainId: _ethereum,
            lzChainId: 1
        });
        _lzAddressesPerChain["polygon"] = LZAddresses({
            endpoint: 0x3c2269811836af69497E5F486A85D7316753cf62,
            chainId: _polygon,
            lzChainId: 9
        });
        _lzAddressesPerChain["fantom"] = LZAddresses({
            endpoint: 0xb6319cC6c8c27A8F5dAF0dD3DF91EA35C4720dd7,
            chainId: _fantom,
            lzChainId: 12
        });

        _contractStableMaster = new MockStableMaster();

        _agTokenSideChainMultiBridge = new AgTokenSideChainMultiBridge();
        vm.store(address(_agTokenSideChainMultiBridge), bytes32(uint256(0)), bytes32(uint256(0)));

        _contractCoreBorrow = new CoreBorrow();
        vm.store(address(_contractCoreBorrow), bytes32(uint256(0)), bytes32(uint256(0)));
        _contractCoreBorrow.initialize(_governor, _guardian);

        _contractTreasury = new Treasury();
        vm.store(address(_contractTreasury), bytes32(uint256(0)), bytes32(uint256(0)));
        _contractTreasury.initialize(_contractCoreBorrow, _agTokenSideChainMultiBridge);

        _oracle = new MockOracle(5 ether, _contractTreasury);
        _collateral = new MockToken("Name", "SYM", 18);

        _mockToken = new MockToken("Mock Token", "MOCK", 18);

        _layerZeroBridge = new LayerZeroBridge();
        vm.store(address(_layerZeroBridge), bytes32(uint256(0)), bytes32(uint256(0)));
        _layerZeroBridge.initialize(
            "agEUR Bridge",
            _lzAddressesPerChain["polygon"].endpoint,
            address(_contractTreasury)
        );

        _layerZeroBridgeToken = new LayerZeroBridgeToken();
        vm.store(address(_layerZeroBridgeToken), bytes32(uint256(0)), bytes32(uint256(0)));
        _layerZeroBridgeToken.initialize(
            "agEUR bridge",
            "agEUR B",
            _lzAddressesPerChain["polygon"].endpoint,
            address(_contractTreasury),
            1000 ether
        );

        vm.startPrank(_governor);
        _agTokenSideChainMultiBridge.initialize("agEUR sidechain", "agEUR S", address(_contractTreasury));
        _agTokenSideChainMultiBridge.addBridgeToken(address(_layerZeroBridge), 100000 ether, 10000 ether, 1e7, false);
        vm.stopPrank();
    }

    function testTransfer() public {
        vm.selectFork(_polygon);

        deal(address(_mockToken), _sender, 1 ether);
        vm.prank(_sender);
        _mockToken.transfer(_receiver, 1 ether);
    }

    function testSendLZ() public {
        vm.selectFork(_polygon);

        vm.deal(address(this), 10 ether);
        vm.deal(_sender, 10 ether);
        deal(address(_agTokenSideChainMultiBridge), _sender, 10 ether);

        vm.prank(_governor);
        _layerZeroBridge.setTrustedRemote(_lzAddressesPerChain["fantom"].lzChainId, abi.encode(_remote));

        vm.startPrank(_sender);
        _agTokenSideChainMultiBridge.approve(address(_layerZeroBridge), 1 ether);
        _layerZeroBridge.send{ value: 0.1 ether }(
            _lzAddressesPerChain["fantom"].lzChainId,
            abi.encodePacked(_receiver),
            0.2 ether,
            _sender,
            address(0),
            abi.encodePacked(uint16(1), uint256(200000))
        );

        vm.stopPrank();
    }
}
