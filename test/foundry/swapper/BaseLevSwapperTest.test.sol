// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.12;

// import "@openzeppelin/contracts-upgradeable/interfaces/IERC20MetadataUpgradeable.sol";
// import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
// import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

// import "../BaseTest.test.sol";
// import "../../../contracts/interfaces/ICoreBorrow.sol";
// import "../../../contracts/mock/MockTokenPermit.sol";
// import { BaseLevSwapper } from "../../../contracts/mock/MockBorrowStaker.sol";

// contract CoreBorrowStakerTest is BaseTest {
//     using stdStorage for StdStorage;

//     MockTokenPermit public asset;
//     MockTokenPermit public rewardToken;
//     MockTokenPermit public otherToken;
//     MockBorrowStaker public stakerImplementation;
//     MockBorrowStaker public staker;
//     uint8 public decimalToken = 18;
//     uint8 public decimalReward = 6;
//     uint256 public rewardAmount = 10**2 * 10**(decimalReward);
//     uint256 public maxTokenAmount = 10**15 * 10**decimalToken;

//     uint256 public constant DEPOSIT_LENGTH = 10;
//     uint256 public constant WITHDRAW_LENGTH = 10;
//     uint256 public constant CLAIMABLE_LENGTH = 50;
//     uint256 public constant CLAIM_LENGTH = 50;

//     function setUp() public override {
//         super.setUp();
//         asset = new MockTokenPermit("agEUR", "agEUR", decimalToken);
//         rewardToken = new MockTokenPermit("reward", "rwrd", decimalReward);
//         otherToken = new MockTokenPermit("other", "other", 18);
//         stakerImplementation = new MockBorrowStaker();
//         staker = MockBorrowStaker(
//             deployUpgradeable(
//                 address(stakerImplementation),
//                 abi.encodeWithSelector(staker.initialize.selector, coreBorrow, asset)
//             )
//         );

//         staker.setRewardToken(rewardToken);
//         staker.setRewardAmount(rewardAmount);
//     }

//     // ================================= INITIALIZE ================================

//     function testInitalizeStakerZeroAddress() public {
//         vm.expectRevert(bytes("Address: low-level delegate call failed"));
//         MockBorrowStaker(
//             deployUpgradeable(
//                 address(stakerImplementation),
//                 abi.encodeWithSelector(stakerImplementation.initialize.selector, address(0))
//             )
//         );
//     }

//     function testInitalize() public {
//         assertEq(staker.name(), "Angle agEUR Staker");
//         assertEq(staker.symbol(), "agstk-agEUR");
//         assertEq(address(staker.asset()), address(asset));
//         assertEq(address(staker.coreBorrow()), address(coreBorrow));
//     }
// }
