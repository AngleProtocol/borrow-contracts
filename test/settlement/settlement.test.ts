import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BigNumber, BigNumberish } from 'ethers';
import { parseEther, parseUnits } from 'ethers/lib/utils';
import { contract, ethers, web3 } from 'hardhat';

import {
  MockSwapper,
  MockSwapper__factory,
  MockToken,
  MockToken__factory,
  MockVaultManager,
  MockVaultManager__factory,
  Settlement,
  Settlement__factory,
} from '../../typechain';
import { parseAmount } from '../../utils/bignumber';
import { expect } from '../utils/chai-setup';
import { inReceipt } from '../utils/expectEvent';
import { time } from '../utils/helpers';

contract('Settlement', () => {
  let deployer: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  let settlement: Settlement;
  let vaultManager: MockVaultManager;
  let collateral: MockToken;
  let stablecoin: MockToken;
  let interestAccumulator: BigNumberish;
  let settlementDuration: BigNumberish;
  let settlementDurationExceeded: BigNumberish;

  beforeEach(async () => {
    [deployer, alice, bob] = await ethers.getSigners();
    vaultManager = (await new MockVaultManager__factory(deployer).deploy(alice.address)) as MockVaultManager;
    await vaultManager.setTreasury(vaultManager.address);
    collateral = (await new MockToken__factory(deployer).deploy('agEUR', 'agEUR', 6)) as MockToken;
    stablecoin = (await new MockToken__factory(deployer).deploy('agEUR', 'agEUR', 18)) as MockToken;
    interestAccumulator = parseUnits('1', 27);
    await vaultManager.setParams(
      alice.address,
      collateral.address,
      stablecoin.address,
      parseEther('1'),
      interestAccumulator,
      parseAmount.gwei('0.5'),
      parseEther('3'),
    );
    settlement = (await new Settlement__factory(deployer).deploy(vaultManager.address)) as Settlement;
    settlementDuration = BigNumber.from(86400 * 3);
    settlementDurationExceeded = BigNumber.from(86400 * 4);
    await stablecoin.mint(alice.address, parseEther('100'));
    await stablecoin.connect(alice).approve(settlement.address, parseEther('100'));
  });

  describe('constructor', () => {
    it('success - contract initialized', async () => {
      expect(await settlement.vaultManager()).to.be.equal(vaultManager.address);
      expect(await settlement.stablecoin()).to.be.equal(stablecoin.address);
      expect(await settlement.collateral()).to.be.equal(collateral.address);
      expect(await settlement.OVER_COLLATERALIZED_CLAIM_DURATION()).to.be.equal(settlementDuration);
    });
  });
  describe('activateSettlement', () => {
    it('reverts - nonGovernor', async () => {
      await expect(settlement.activateSettlement()).to.be.revertedWith('NotGovernor');
    });
    it('success - correctly initialized', async () => {
      const receipt = await (await settlement.connect(alice).activateSettlement()).wait();
      expect(await settlement.oracleValue()).to.be.equal(parseEther('1'));
      expect(await settlement.interestAccumulator()).to.be.equal(interestAccumulator);
      expect(await settlement.collateralFactor()).to.be.equal(parseAmount.gwei('0.5'));
      inReceipt(receipt, 'SettlementActivated', {});
    });
  });
  describe('claimOverCollateralizedVault', () => {
    it('reverts - not activated', async () => {
      await expect(settlement.claimOverCollateralizedVault(1, bob.address, bob.address, '0x')).to.be.revertedWith(
        'SettlementNotInitialized',
      );
    });
    it('reverts - activated but time passed', async () => {
      await settlement.connect(alice).activateSettlement();
      await time.increase(settlementDurationExceeded);
      await expect(settlement.claimOverCollateralizedVault(1, bob.address, bob.address, '0x')).to.be.revertedWith(
        'SettlementNotInitialized',
      );
    });
    it('reverts - non owner', async () => {
      await settlement.connect(alice).activateSettlement();
      await expect(settlement.claimOverCollateralizedVault(1, bob.address, bob.address, '0x')).to.be.revertedWith(
        'NotOwner',
      );
    });
    it('reverts - vault to be liquidated', async () => {
      await settlement.connect(alice).activateSettlement();
      await vaultManager.connect(alice).setOwner(1, alice.address);
      await vaultManager.connect(alice).setVaultData(parseEther('1'), parseUnits('1', 5), 1);
      await expect(
        settlement.connect(alice).claimOverCollateralizedVault(1, bob.address, bob.address, '0x'),
      ).to.be.revertedWith('InsolventVault');
    });
    it('reverts - vault claimed but no collateral available', async () => {
      await settlement.connect(alice).activateSettlement();
      await vaultManager.connect(alice).setOwner(1, alice.address);
      await vaultManager.connect(alice).setVaultData(parseEther('1'), parseUnits('3', 6), 1);
      await expect(
        settlement.connect(alice).claimOverCollateralizedVault(1, bob.address, bob.address, '0x'),
      ).to.be.revertedWith('ERC20: transfer amount exceeds balance');
    });
    it('success - vault claimed but no collateral available', async () => {
      await settlement.connect(alice).activateSettlement();
      await vaultManager.connect(alice).setOwner(1, alice.address);
      await vaultManager.connect(alice).setVaultData(parseEther('1'), parseUnits('3', 6), 1);
      await collateral.mint(settlement.address, parseUnits('1', 10));
      const receipt = await (
        await settlement.connect(alice).claimOverCollateralizedVault(1, bob.address, bob.address, '0x')
      ).wait();
      inReceipt(receipt, 'VaultClaimed', {
        vaultID: 1,
        stablecoinAmount: parseEther('1'),
        collateralAmount: parseUnits('3', 6),
      });
      expect(await settlement.vaultCheck(1)).to.be.true;
      expect(await stablecoin.balanceOf(settlement.address)).to.be.equal(parseEther('1'));
      expect(await collateral.balanceOf(bob.address)).to.be.equal(parseUnits('3', 6));
    });
    it('success - vault claimed but no collateral available and other address involved in repayment', async () => {
      await settlement.connect(alice).activateSettlement();
      await vaultManager.connect(alice).setOwner(1, alice.address);
      await vaultManager.connect(alice).setVaultData(parseEther('1'), parseUnits('3', 6), 1);
      await collateral.mint(settlement.address, parseUnits('1', 10));
      const mockSwapper = (await new MockSwapper__factory(deployer).deploy()) as MockSwapper;
      const receipt = await (
        await settlement
          .connect(alice)
          .claimOverCollateralizedVault(1, bob.address, mockSwapper.address, web3.utils.keccak256('test'))
      ).wait();
      inReceipt(receipt, 'VaultClaimed', {
        vaultID: 1,
        stablecoinAmount: parseEther('1'),
        collateralAmount: parseUnits('3', 6),
      });
      expect(await settlement.vaultCheck(1)).to.be.true;
      expect(await stablecoin.balanceOf(settlement.address)).to.be.equal(parseEther('1'));
      expect(await collateral.balanceOf(bob.address)).to.be.equal(parseUnits('3', 6));
      expect(await mockSwapper.counter()).to.be.equal(1);
    });
    it('reverts - vault already claimed', async () => {
      await settlement.connect(alice).activateSettlement();
      await vaultManager.connect(alice).setOwner(1, alice.address);
      await vaultManager.connect(alice).setVaultData(parseEther('1'), parseUnits('3', 6), 1);
      await collateral.mint(settlement.address, parseUnits('1', 10));
      await settlement.connect(alice).claimOverCollateralizedVault(1, bob.address, bob.address, '0x');
      await expect(settlement.claimOverCollateralizedVault(1, bob.address, bob.address, '0x')).to.be.revertedWith(
        'VaultAlreadyClaimed',
      );
    });
  });
  describe('activateGlobalClaimPeriod', () => {
    it('reverts - non governor', async () => {
      await expect(settlement.connect(bob).activateGlobalClaimPeriod()).to.be.revertedWith('NotGovernor');
    });
    it('reverts - not activated', async () => {
      await expect(settlement.connect(alice).activateGlobalClaimPeriod()).to.be.revertedWith(
        'RestrictedClaimPeriodNotEnded',
      );
    });
    it('reverts - time not elapsed', async () => {
      await settlement.connect(alice).activateSettlement();
      await expect(settlement.connect(alice).activateGlobalClaimPeriod()).to.be.revertedWith(
        'RestrictedClaimPeriodNotEnded',
      );
    });
    it('success - with no debt', async () => {
      await settlement.connect(alice).activateSettlement();
      await time.increase(settlementDurationExceeded);
      await stablecoin.mint(settlement.address, parseEther('3'));
      const receipt = await (await settlement.connect(alice).activateGlobalClaimPeriod()).wait();
      inReceipt(receipt, 'GlobalClaimPeriodActivated', {
        _collateralStablecoinExchangeRate: 0,
      });
      expect(await settlement.collateralStablecoinExchangeRate()).to.be.equal(0);
      expect(await settlement.exchangeRateComputed()).to.be.equal(true);
      expect(await settlement.leftOverCollateral()).to.be.equal(0);
    });
    it('success - with a null collateral balance', async () => {
      await settlement.connect(alice).activateSettlement();
      await time.increase(settlementDurationExceeded);
      await stablecoin.mint(settlement.address, parseEther('2'));
      const receipt = await (await settlement.connect(alice).activateGlobalClaimPeriod()).wait();
      inReceipt(receipt, 'GlobalClaimPeriodActivated', {
        _collateralStablecoinExchangeRate: 0,
      });
      expect(await settlement.collateralStablecoinExchangeRate()).to.be.equal(0);
      expect(await settlement.exchangeRateComputed()).to.be.equal(true);
      expect(await settlement.leftOverCollateral()).to.be.equal(0);
    });
    it('success - with a collateral balance not sufficient to cover for the stablecoins', async () => {
      await settlement.connect(alice).activateSettlement();
      await time.increase(settlementDurationExceeded);
      await stablecoin.mint(settlement.address, parseEther('1'));
      // Normalized debt will be 2 and we have only 1 of collateral: meaning 50% won't be covered
      await collateral.mint(settlement.address, parseUnits('1', 6));
      const receipt = await (await settlement.connect(alice).activateGlobalClaimPeriod()).wait();
      inReceipt(receipt, 'GlobalClaimPeriodActivated', {
        _collateralStablecoinExchangeRate: parseUnits('0.5', 6),
      });
      expect(await settlement.collateralStablecoinExchangeRate()).to.be.equal(parseUnits('0.5', 6));
      expect(await settlement.exchangeRateComputed()).to.be.equal(true);
      expect(await settlement.leftOverCollateral()).to.be.equal(0);
    });
    it('success - with a collateral balance larger than the amount of stablecoins', async () => {
      await settlement.connect(alice).activateSettlement();
      await time.increase(settlementDurationExceeded);
      await stablecoin.mint(settlement.address, parseEther('2'));
      // Normalized debt will be 1 and we have 2 of collateral: meaning we'll have some leftover debt
      await collateral.mint(settlement.address, parseUnits('2.5', 6));
      const receipt = await (await settlement.connect(alice).activateGlobalClaimPeriod()).wait();
      inReceipt(receipt, 'GlobalClaimPeriodActivated', {
        _collateralStablecoinExchangeRate: parseUnits('1', 6),
      });
      expect(await settlement.collateralStablecoinExchangeRate()).to.be.equal(parseUnits('1', 6));
      expect(await settlement.exchangeRateComputed()).to.be.equal(true);
      expect(await settlement.leftOverCollateral()).to.be.equal(parseUnits('1.5', 6));
    });
  });
  describe('claimCollateralFromStablecoins', () => {
    it('reverts - exchange rate not computed', async () => {
      await expect(
        settlement.connect(alice).claimCollateralFromStablecoins(parseEther('1'), bob.address, bob.address, '0x'),
      ).to.be.revertedWith('GlobalClaimPeriodNotStarted');
    });
    it('success - when exchange rate is inferior to 1', async () => {
      await settlement.connect(alice).activateSettlement();
      await time.increase(settlementDurationExceeded);
      await stablecoin.mint(settlement.address, parseEther('1'));
      // Normalized debt will be 2 and we have only 1 of collateral: meaning 50% won't be covered
      await collateral.mint(settlement.address, parseUnits('1', 6));
      await settlement.connect(alice).activateGlobalClaimPeriod();
      await settlement.connect(alice).claimCollateralFromStablecoins(parseEther('0.5'), bob.address, bob.address, '0x');
      expect(await collateral.balanceOf(bob.address)).to.be.equal(parseUnits('0.25', 6));
    });
    it('success - when exchange rate is inferior to 1 and uses external contract to proceed to the call', async () => {
      await settlement.connect(alice).activateSettlement();
      await time.increase(settlementDurationExceeded);
      await stablecoin.mint(settlement.address, parseEther('1'));
      // Normalized debt will be 2 and we have only 1 of collateral: meaning 50% won't be covered
      await collateral.mint(settlement.address, parseUnits('1', 6));
      await settlement.connect(alice).activateGlobalClaimPeriod();
      const mockSwapper = (await new MockSwapper__factory(deployer).deploy()) as MockSwapper;
      await settlement
        .connect(alice)
        .claimCollateralFromStablecoins(
          parseEther('0.5'),
          bob.address,
          mockSwapper.address,
          web3.utils.keccak256('test'),
        );
      expect(await collateral.balanceOf(bob.address)).to.be.equal(parseUnits('0.25', 6));
      expect(await mockSwapper.counter()).to.be.equal(1);
    });
    it('success - when exchange rate is greater than 1', async () => {
      await settlement.connect(alice).activateSettlement();
      await time.increase(settlementDurationExceeded);
      await stablecoin.mint(settlement.address, parseEther('2'));
      // Normalized debt will be 1 and we have 2 of collateral: meaning we'll have some leftover debt
      await collateral.mint(settlement.address, parseUnits('2.5', 6));
      await settlement.connect(alice).activateGlobalClaimPeriod();
      await settlement.connect(alice).claimCollateralFromStablecoins(parseEther('0.5'), bob.address, bob.address, '0x');
      expect(await collateral.balanceOf(bob.address)).to.be.equal(parseUnits('0.5', 6));
    });
  });
  describe('recoverERC20', () => {
    it('reverts - nonGovernor', async () => {
      await expect(settlement.recoverERC20(stablecoin.address, bob.address, 1)).to.be.revertedWith('NotGovernor');
    });
    it('success - non collateral token', async () => {
      await stablecoin.mint(settlement.address, parseEther('2'));
      const receipt = await (
        await settlement.connect(alice).recoverERC20(stablecoin.address, bob.address, parseEther('2'))
      ).wait();
      inReceipt(receipt, 'Recovered', {
        tokenAddress: stablecoin.address,
        to: bob.address,
        amount: parseEther('2'),
      });
      expect(await stablecoin.balanceOf(bob.address)).to.be.equal(parseEther('2'));
    });
    it('reverts - collateral token and exchange rate not computed', async () => {
      await expect(settlement.connect(alice).recoverERC20(collateral.address, bob.address, 1)).to.be.revertedWith(
        'GlobalClaimPeriodNotStarted',
      );
    });
    it('reverts - collateral token, exchange rate computed but to big amount to recover', async () => {
      await settlement.connect(alice).activateSettlement();
      await time.increase(settlementDurationExceeded);
      await stablecoin.mint(settlement.address, parseEther('2'));
      await collateral.mint(settlement.address, parseUnits('2.5', 6));
      await settlement.connect(alice).activateGlobalClaimPeriod();
      await expect(settlement.connect(alice).recoverERC20(collateral.address, bob.address, parseUnits('2.5', 6))).to.be
        .reverted;
    });
    it('success - collateral token, exchange rate computed and correct amount to recover', async () => {
      await settlement.connect(alice).activateSettlement();
      await time.increase(settlementDurationExceeded);
      await stablecoin.mint(settlement.address, parseEther('2'));
      await collateral.mint(settlement.address, parseUnits('2.5', 6));
      await settlement.connect(alice).activateGlobalClaimPeriod();
      const receipt = await (
        await settlement.connect(alice).recoverERC20(collateral.address, bob.address, parseUnits('1', 6))
      ).wait();
      inReceipt(receipt, 'Recovered', {
        tokenAddress: collateral.address,
        to: bob.address,
        amount: parseUnits('1', 6),
      });
      expect(await collateral.balanceOf(bob.address)).to.be.equal(parseUnits('1', 6));
      expect(await settlement.leftOverCollateral()).to.be.equal(parseUnits('0.5', 6));
    });
  });
});
