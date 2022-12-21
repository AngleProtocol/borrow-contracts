// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.12;

import "../BaseTest.test.sol";
import "../../../contracts/interfaces/ICoreBorrow.sol";
import "../../../contracts/mock/MockTokenPermit.sol";
import "../../../contracts/mock/MockVaultManager.sol";
import { MockSanTokenERC4626Adapter, SanTokenERC4626Adapter, ERC20Upgradeable } from "../../../contracts/mock/MockSanTokenERC4626Adapter.sol";
import { MockStableMasterSanWrapper } from "../../../contracts/mock/MockStableMaster.sol";

contract SanTokenERC4626AdapterTest is BaseTest {
    using stdStorage for StdStorage;

    MockTokenPermit public token;
    MockTokenPermit public sanToken;
    MockSanTokenERC4626Adapter public sanTokenAdapterImplementation;
    MockSanTokenERC4626Adapter public sanTokenAdapter;
    MockStableMasterSanWrapper public stableMaster;
    uint256 internal constant _BASE = 10**18;
    uint8 public decimalToken = 18;
    uint256 public maxTokenAmount = 10**9 * 10**decimalToken;
    uint256 public maxLockedInterest = 10**6 * 10**decimalToken;
    uint256 public maxInterestDistributed = 10**4 * 10**decimalToken;

    uint256 public constant WITHDRAW_LENGTH = 30;

    function setUp() public override {
        super.setUp();
        token = new MockTokenPermit("DAI", "DAI", decimalToken);
        sanToken = new MockTokenPermit("sanDAI", "sanDAI", decimalToken);
        stableMaster = new MockStableMasterSanWrapper();
        sanTokenAdapterImplementation = new MockSanTokenERC4626Adapter();
        sanTokenAdapter = MockSanTokenERC4626Adapter(
            deployUpgradeable(
                address(sanTokenAdapterImplementation),
                abi.encodeWithSelector(sanTokenAdapter.setStableMaster.selector, address(stableMaster))
            )
        );
        sanTokenAdapter.setSanToken(address(sanToken));
        sanTokenAdapter.setAsset(address(token));
        sanTokenAdapter.setPoolManager(address(stableMaster));
        sanTokenAdapter.initialize();

        stableMaster.setPoolManagerToken(address(stableMaster), address(token));
        stableMaster.setPoolManagerSanToken(address(stableMaster), address(sanToken));
        stableMaster.setSanRate(address(stableMaster), _BASE);
        stableMaster.setSLPData(address(stableMaster), 0, maxInterestDistributed, 0);
    }

    // ================================ MAX AND MIN ================================

    function testRedeemTooLarge(
        uint256[2] memory amounts,
        uint256 availableFund,
        uint256[2] memory accounts
    ) public {
        address account;
        {
            uint256 randomIndex = bound(accounts[0], 0, 3);
            account = randomIndex == 0 ? _alice : randomIndex == 1 ? _bob : randomIndex == 2 ? _charlie : _dylan;
        }

        vm.startPrank(account);
        uint256 amount = bound(amounts[0], 1, maxTokenAmount);
        deal(address(token), account, amount);
        token.approve(address(sanTokenAdapter), amount);
        sanTokenAdapter.deposit(amount, account);

        // fake stableMaster deposit on start or gains
        deal(
            address(token),
            address(stableMaster),
            bound(availableFund, 10**(decimalToken / 2), maxTokenAmount * 10**7)
        );

        amount = bound(amounts[1], 1, maxTokenAmount);
        deal(address(token), account, amount);
        token.approve(address(sanTokenAdapter), amount);

        uint256 maxRedeemable = sanTokenAdapter.maxRedeem(account);
        uint256 assets = sanTokenAdapter.previewRedeem(maxRedeemable + 1);
        if (maxRedeemable > 0) {
            if (assets == 0) vm.expectRevert(SanTokenERC4626Adapter.InsufficientAssets.selector);
            else vm.expectRevert(bytes("ERC20: burn amount exceeds balance"));
            sanTokenAdapter.redeem(maxRedeemable + 1, account, account);
        }
        vm.stopPrank();
    }

    function testWithdrawTooLarge(
        uint256[2] memory amounts,
        uint256 availableFund,
        uint256[2] memory accounts
    ) public {
        address account;
        {
            uint256 randomIndex = bound(accounts[0], 0, 3);
            account = randomIndex == 0 ? _alice : randomIndex == 1 ? _bob : randomIndex == 2 ? _charlie : _dylan;
        }

        vm.startPrank(account);
        uint256 amount = bound(amounts[0], 1, maxTokenAmount);
        deal(address(token), account, amount);
        token.approve(address(sanTokenAdapter), amount);
        sanTokenAdapter.deposit(amount, account);

        // fake stableMaster deposit on start or gains
        deal(
            address(token),
            address(stableMaster),
            bound(availableFund, 10**(decimalToken / 2), maxTokenAmount * 10**7)
        );

        amount = bound(amounts[1], 1, maxTokenAmount);
        deal(address(token), account, amount);
        token.approve(address(sanTokenAdapter), amount);

        uint256 maxWithdraw = sanTokenAdapter.maxWithdraw(account);
        if (maxWithdraw > 0) {
            vm.expectRevert(bytes("ERC20: burn amount exceeds balance"));
            sanTokenAdapter.withdraw(maxWithdraw + 1, account, account);
        }
        vm.stopPrank();
    }

    function testRedeemSuccess(
        uint256[2] memory amounts,
        uint256 propRedeem,
        uint256 availableFund,
        uint256[2] memory accounts
    ) public {
        address account;
        {
            uint256 randomIndex = bound(accounts[0], 0, 3);
            account = randomIndex == 0 ? _alice : randomIndex == 1 ? _bob : randomIndex == 2 ? _charlie : _dylan;
        }

        vm.startPrank(account);
        uint256 amount = bound(amounts[0], 1, maxTokenAmount);
        deal(address(token), account, amount);
        token.approve(address(sanTokenAdapter), amount);
        sanTokenAdapter.deposit(amount, account);

        // fake stableMaster deposit on start or gains
        deal(
            address(token),
            address(stableMaster),
            bound(availableFund, 10**(decimalToken / 2), maxTokenAmount * 10**7)
        );

        amount = bound(amounts[1], 1, maxTokenAmount);
        deal(address(token), account, amount);
        token.approve(address(sanTokenAdapter), amount);

        uint256 maxRedeemable = sanTokenAdapter.maxRedeem(account);
        if (maxRedeemable > 0) {
            uint256 shares = (maxRedeemable * bound(propRedeem, 0, BASE_PARAMS)) / BASE_PARAMS;
            uint256 assets = sanTokenAdapter.previewRedeem(shares);
            if (assets == 0) vm.expectRevert(SanTokenERC4626Adapter.InsufficientAssets.selector);
            sanTokenAdapter.redeem(shares, account, account);
        }
        vm.stopPrank();
    }

    function testWithdrawSuccess(
        uint256[2] memory amounts,
        uint256 propWithdraw,
        uint256 availableFund,
        uint256[2] memory accounts
    ) public {
        address account;
        {
            uint256 randomIndex = bound(accounts[0], 0, 3);
            account = randomIndex == 0 ? _alice : randomIndex == 1 ? _bob : randomIndex == 2 ? _charlie : _dylan;
        }

        vm.startPrank(account);
        uint256 amount = bound(amounts[0], 1, maxTokenAmount);
        deal(address(token), account, amount);
        token.approve(address(sanTokenAdapter), amount);
        sanTokenAdapter.deposit(amount, account);

        // fake stableMaster deposit on start or gains
        deal(
            address(token),
            address(stableMaster),
            bound(availableFund, 10**(decimalToken / 2), maxTokenAmount * 10**7)
        );

        amount = bound(amounts[1], 1, maxTokenAmount);
        deal(address(token), account, amount);
        token.approve(address(sanTokenAdapter), amount);

        uint256 maxWithdraw = sanTokenAdapter.maxWithdraw(account);
        if (maxWithdraw > 0) {
            amount = (maxWithdraw * bound(propWithdraw, 0, BASE_PARAMS)) / BASE_PARAMS;
            sanTokenAdapter.withdraw(amount, account, account);
        }
        vm.stopPrank();
    }

    // ==================================== E2E ====================================

    function testMultiDepositRedeemRewardsSuccess(
        uint256[WITHDRAW_LENGTH] memory amounts,
        uint256[WITHDRAW_LENGTH] memory sanRates,
        bool[WITHDRAW_LENGTH] memory isDepositWithdraw,
        uint256[2 * WITHDRAW_LENGTH] memory lockedInterestsSlippage,
        uint256[2 * WITHDRAW_LENGTH] memory accounts,
        uint64[WITHDRAW_LENGTH] memory elapseTime
    ) public {
        uint256 prevSanRate = _BASE;
        for (uint256 i = 0; i < amounts.length; ++i) {
            address account;
            address receiver;
            {
                uint256 randomIndex = bound(accounts[i * 2], 0, 3);
                account = randomIndex == 0 ? _alice : randomIndex == 1 ? _bob : randomIndex == 2 ? _charlie : _dylan;
                uint256 randomIndexReceiver = bound(accounts[i * 2 + 1], 0, 3);
                receiver = randomIndexReceiver == 0 ? _alice : randomIndexReceiver == 1
                    ? _bob
                    : randomIndexReceiver == 2
                    ? _charlie
                    : _dylan;
            }

            stableMaster.setSLPData(
                address(stableMaster),
                bound(lockedInterestsSlippage[i * 2], 1, maxLockedInterest),
                maxInterestDistributed,
                uint64(bound(lockedInterestsSlippage[i * 2 + 1], 0, BASE_PARAMS))
            );
            stableMaster.setSanRate(address(stableMaster), bound(sanRates[i], 10**15, 10**20));

            if (sanTokenAdapter.balanceOf(account) == 0) isDepositWithdraw[i] = true;
            (uint256 newSanRate, uint64 slippage) = stableMaster.estimateSanRate(address(stableMaster));
            // to not have missing funds on the stableMaster
            deal(
                address(token),
                address(stableMaster),
                (token.balanceOf(address(stableMaster)) * newSanRate) / prevSanRate
            );
            prevSanRate = newSanRate;

            uint256 amount;
            vm.startPrank(account);
            if (isDepositWithdraw[i]) {
                amount = bound(amounts[i], 1, maxTokenAmount);
                deal(address(token), account, amount);
                token.approve(address(sanTokenAdapter), amount);

                uint256 amountExpected = _sanValueAfterdeposit(amount, newSanRate);
                uint256 previewDeposit = sanTokenAdapter.previewDeposit(amount);
                uint256 balanceReceiverSanTokenBefore = sanTokenAdapter.balanceOf(receiver);
                uint256 balanceAccountSanTokenBefore = sanTokenAdapter.balanceOf(account);
                uint256 receivedSanTokens = sanTokenAdapter.deposit(amount, receiver);
                assertEq(sanTokenAdapter.balanceOf(receiver) - balanceReceiverSanTokenBefore, receivedSanTokens);
                if (account != receiver) assertEq(sanTokenAdapter.balanceOf(account) - balanceAccountSanTokenBefore, 0);
                assertEq(previewDeposit, receivedSanTokens);
                assertEq(amountExpected, receivedSanTokens);
            } else {
                uint256 balanceSanTokenBefore = sanTokenAdapter.balanceOf(account);
                amount = bound(amounts[i], 1, BASE_PARAMS);
                uint256 toWithdraw = (amount * balanceSanTokenBefore) / BASE_PARAMS;

                uint256 amountExpected = _tokenValueAfterRedeem(toWithdraw, newSanRate, slippage);
                uint256 previewRedeem = sanTokenAdapter.previewRedeem(toWithdraw);
                if (previewRedeem == 0) {
                    vm.expectRevert(SanTokenERC4626Adapter.InsufficientAssets.selector);
                    sanTokenAdapter.redeem(toWithdraw, receiver, account);
                } else {
                    uint256 balanceReceiverTokenBefore = token.balanceOf(receiver);
                    uint256 balanceAccountTokenBefore = token.balanceOf(account);
                    uint256 receivedTokens = sanTokenAdapter.redeem(toWithdraw, receiver, account);
                    assertEq(token.balanceOf(receiver) - balanceReceiverTokenBefore, receivedTokens);
                    if (receiver != account) assertEq(token.balanceOf(account) - balanceAccountTokenBefore, 0);
                    assertEq(previewRedeem, receivedTokens);
                    assertEq(amountExpected, receivedTokens);
                    assertEq(balanceSanTokenBefore - sanTokenAdapter.balanceOf(account), toWithdraw);
                }
            }
            vm.stopPrank();

            // advance in time for rewards to be taken into account
            elapseTime[i] = uint64(bound(elapseTime[i], 1, 86400 * 7));
            vm.warp(block.timestamp + elapseTime[i]);
        }
    }

    function testMultiMintWithdrawRewardsSuccess(
        uint256[WITHDRAW_LENGTH] memory amounts,
        uint256[WITHDRAW_LENGTH] memory sanRates,
        bool[WITHDRAW_LENGTH] memory isMintWithdraw,
        uint256[2 * WITHDRAW_LENGTH] memory lockedInterestsSlippage,
        uint256[2 * WITHDRAW_LENGTH] memory accounts,
        uint64[WITHDRAW_LENGTH] memory elapseTime
    ) public {
        uint256 prevSanRate = _BASE;
        for (uint256 i = 0; i < amounts.length; ++i) {
            address account;
            address receiver;
            {
                uint256 randomIndex = bound(accounts[i * 2], 0, 3);
                account = randomIndex == 0 ? _alice : randomIndex == 1 ? _bob : randomIndex == 2 ? _charlie : _dylan;
                uint256 randomIndexReceiver = bound(accounts[i * 2 + 1], 0, 3);
                receiver = randomIndexReceiver == 0 ? _alice : randomIndexReceiver == 1
                    ? _bob
                    : randomIndexReceiver == 2
                    ? _charlie
                    : _dylan;
            }

            stableMaster.setSLPData(
                address(stableMaster),
                bound(lockedInterestsSlippage[i * 2], 1, maxLockedInterest),
                maxInterestDistributed,
                // to not have an arithmetic overflow in the `_sanTokenValueAfterWithdraw`
                uint64(bound(lockedInterestsSlippage[i * 2 + 1], 0, BASE_PARAMS - 1))
            );
            stableMaster.setSanRate(address(stableMaster), bound(sanRates[i], 10**15, 10**20));

            if (sanTokenAdapter.balanceOf(account) == 0) isMintWithdraw[i] = true;
            uint64 slippage;
            {
                uint256 newSanRate;
                (newSanRate, slippage) = stableMaster.estimateSanRate(address(stableMaster));
                // to not have missing funds on the stableMaster
                deal(
                    address(token),
                    address(stableMaster),
                    (token.balanceOf(address(stableMaster)) * newSanRate) / prevSanRate
                );

                prevSanRate = newSanRate;
            }

            uint256 amount;
            vm.startPrank(account);
            if (isMintWithdraw[i]) {
                amount = bound(amounts[i], 1, maxTokenAmount);
                uint256 amountExpected = _assetsForMint(amount, prevSanRate);
                uint256 previewMint = sanTokenAdapter.previewMint(amount);
                deal(address(token), account, previewMint);
                token.approve(address(sanTokenAdapter), previewMint);

                uint256 balanceReceiverSanTokenBefore = sanTokenAdapter.balanceOf(receiver);
                uint256 balanceAccountSanTokenBefore = sanTokenAdapter.balanceOf(account);
                uint256 balanceAccountTokenBefore = token.balanceOf(account);
                uint256 paidTokens = sanTokenAdapter.mint(amount, receiver);
                assertEq(sanTokenAdapter.balanceOf(receiver) - balanceReceiverSanTokenBefore, amount);
                assertEq(balanceAccountTokenBefore - token.balanceOf(account), paidTokens);
                if (account != receiver) assertEq(sanTokenAdapter.balanceOf(account) - balanceAccountSanTokenBefore, 0);
                assertEq(previewMint, paidTokens);
                assertApproxEqAbs(amountExpected, paidTokens, 1 wei);
            } else {
                uint256 balanceTokenBefore = sanTokenAdapter.maxWithdraw(account);
                amount = bound(amounts[i], 1, BASE_PARAMS);
                amount = (amount * balanceTokenBefore) / BASE_PARAMS;

                uint256 amountExpected = _sanTokenValueAfterWithdraw(amount, prevSanRate, slippage);
                uint256 previewWithdraw = sanTokenAdapter.previewWithdraw(amount);
                if (previewWithdraw == type(uint256).max) {
                    // vm.expectRevert(SanTokenERC4626Adapter.InsufficientAssets.selector);
                    sanTokenAdapter.withdraw(amount, receiver, account);
                } else {
                    uint256 balanceReceiverTokenBefore = token.balanceOf(receiver);
                    uint256 balanceAccountTokenBefore = token.balanceOf(account);
                    uint256 balanceAccountSanTokenBefore = sanTokenAdapter.balanceOf(account);
                    uint256 burntTokens = sanTokenAdapter.withdraw(amount, receiver, account);
                    assertEq(token.balanceOf(receiver) - balanceReceiverTokenBefore, amount);
                    if (receiver != account) assertEq(token.balanceOf(account) - balanceAccountTokenBefore, 0);
                    assertEq(previewWithdraw, burntTokens);
                    assertApproxEqAbs(amountExpected, burntTokens, 1 wei);
                    assertEq(balanceAccountSanTokenBefore - sanTokenAdapter.balanceOf(account), burntTokens);
                }
            }
            vm.stopPrank();

            // advance in time for rewards to be taken into account
            elapseTime[i] = uint64(bound(elapseTime[i], 1, 86400 * 7));
            vm.warp(block.timestamp + elapseTime[i]);
        }
    }

    // ================================== HELPERS ==================================

    /// @notice Copied from deployed contracts
    function _sanValueAfterdeposit(uint256 amount, uint256 sanRate) internal pure returns (uint256) {
        return (amount * _BASE) / sanRate;
    }

    /// @notice Copied from deployed contracts
    function _tokenValueAfterRedeem(
        uint256 amount,
        uint256 sanRate,
        uint64 slippage
    ) internal pure returns (uint256) {
        // Computing the amount of collateral to give back to the SLP depending on slippage and on the `sanRate`
        return (amount * (BASE_PARAMS - slippage) * sanRate) / (_BASE * BASE_PARAMS);
    }

    function _assetsForMint(uint256 shares, uint256 sanRate) internal pure returns (uint256) {
        return (shares * sanRate) / _BASE;
    }

    function _sanTokenValueAfterWithdraw(
        uint256 amount,
        uint256 sanRate,
        uint64 slippage
    ) internal pure returns (uint256) {
        // Computing the amount of collateral to give back to the SLP depending on slippage and on the `sanRate`
        return (amount * _BASE * BASE_PARAMS) / (BASE_PARAMS - slippage) / sanRate;
    }
}
