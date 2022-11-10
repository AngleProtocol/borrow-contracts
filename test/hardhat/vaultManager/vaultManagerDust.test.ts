import { Oracle, Oracle__factory } from '@angleprotocol/sdk/dist/constants/types';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BigNumber, Signer, utils } from 'ethers';
import { formatBytes32String, parseEther, parseUnits } from 'ethers/lib/utils';
import hre, { contract, ethers, web3 } from 'hardhat';

import {
  AgToken,
  AgToken__factory,
  MockOracle,
  MockOracle__factory,
  MockStableMaster,
  MockStableMaster__factory,
  MockSwapper,
  MockSwapper__factory,
  MockSwapperWithSwap,
  MockSwapperWithSwap__factory,
  MockToken,
  MockToken__factory,
  MockTreasury,
  MockTreasury__factory,
  MockVeBoostProxy,
  MockVeBoostProxy__factory,
  VaultManager,
  VaultManager__factory,
} from '../../../typechain';
import { expect } from '../utils/chai-setup';
import { inIndirectReceipt, inReceipt } from '../utils/expectEvent';
import {
  addCollateral,
  angle,
  angleUnprotected,
  borrow,
  closeVault,
  createVault,
  deployUpgradeable,
  displayVaultState,
  expectApprox,
  getDebtIn,
  increaseTime,
  latestTime,
  permit,
  removeCollateral,
  repayDebt,
  ZERO_ADDRESS,
} from '../utils/helpers';
import { signPermit } from '../utils/sigUtils';

contract('VaultManager - Dust Modification interactions', () => {
  const log = true;

  let deployer: SignerWithAddress;
  let governor: SignerWithAddress;
  let guardian: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let charlie: SignerWithAddress;

  let treasury: MockTreasury;
  let collateral: MockToken;
  let oracle: MockOracle;
  let stableMaster: MockStableMaster;
  let agToken: AgToken;
  let vaultManager: VaultManager;
  let mockSwapper: MockSwapper;
  let mockSwapperWithSwap: MockSwapperWithSwap;

  const impersonatedSigners: { [key: string]: Signer } = {};

  const collatBase = 10;
  const yearlyRate = 1.05;
  const ratePerSecond = yearlyRate ** (1 / (365 * 24 * 3600)) - 1;
  const params = {
    debtCeiling: parseEther('100'),
    collateralFactor: 0.8e9,
    targetHealthFactor: 1.1e9,
    borrowFee: 0.1e9,
    interestRate: 0,
    liquidationSurcharge: 0.9e9,
    maxLiquidationDiscount: 0.1e9,
    liquidationBooster: 0.1e9,
    whitelistingActivated: false,
    baseBoost: 1e9,
  };

  before(async () => {
    ({ deployer, alice, bob, governor, guardian, charlie } = await ethers.getNamedSigners());
    // add any addresses you want to impersonate here
    const impersonatedAddresses = [{ address: '0xdC4e6DFe07EFCa50a197DF15D9200883eF4Eb1c8', name: 'governor' }];

    for (const ob of impersonatedAddresses) {
      await hre.network.provider.request({
        method: 'hardhat_impersonateAccount',
        params: [ob.address],
      });

      await hre.network.provider.send('hardhat_setBalance', [ob.address, '0x10000000000000000000000000000']);

      impersonatedSigners[ob.name] = await ethers.getSigner(ob.address);
    }
  });

  beforeEach(async () => {
    // If the forked-network state needs to be reset between each test, run this
    // await network.provider.request({method: 'hardhat_reset', params: []});

    stableMaster = await new MockStableMaster__factory(deployer).deploy();

    agToken = (await deployUpgradeable(new AgToken__factory(deployer))) as AgToken;
    await agToken.connect(deployer).initialize('agEUR', 'agEUR', stableMaster.address);

    collateral = await new MockToken__factory(deployer).deploy('A', 'A', collatBase);

    vaultManager = (await deployUpgradeable(new VaultManager__factory(deployer), 0.1e9, 0.1e9)) as VaultManager;

    treasury = await new MockTreasury__factory(deployer).deploy(
      agToken.address,
      governor.address,
      guardian.address,
      vaultManager.address,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
    );
    await agToken.connect(impersonatedSigners.governor).setUpTreasury(treasury.address);
    await treasury.addMinter(agToken.address, vaultManager.address);

    oracle = await new MockOracle__factory(deployer).deploy(parseUnits('2', 18), treasury.address);
    await vaultManager.initialize(treasury.address, collateral.address, oracle.address, params, 'USDC/agEUR');
    await vaultManager.connect(guardian).togglePause();
  });
  describe('setLiquidationBoostParameters', () => {
    it('reverts - non guardian or invalid param', async () => {
      await expect(
        vaultManager.connect(alice).setLiquidationBoostParameters(ZERO_ADDRESS, [], [0.1e9]),
      ).to.be.revertedWith('NotGovernorOrGuardian');
      await expect(
        vaultManager.connect(guardian).setLiquidationBoostParameters(ZERO_ADDRESS, [], [0]),
      ).to.be.revertedWith('InvalidSetOfParameters');
      await expect(vaultManager.connect(guardian).setLiquidationBoostParameters(ZERO_ADDRESS, [], [])).to.be.reverted;
    });
    it('success - when guardian is calling', async () => {
      await vaultManager.connect(governor).setLiquidationBoostParameters(ZERO_ADDRESS, [], [0.1e9]);
      expect(await vaultManager.yLiquidationBoost(0)).to.be.equal(0.1e9);
    });
  });
  describe('setDusts', () => {
    it('reverts - non governor', async () => {
      await expect(vaultManager.connect(alice).setDusts(0, 0)).to.be.revertedWith('NotGovernor');
      await expect(vaultManager.connect(guardian).setDusts(0, 0)).to.be.revertedWith('NotGovernor');
    });
    it('success - when governor is calling', async () => {
      await vaultManager.connect(governor).setDusts(1, 1);
      expect(await vaultManager.dustOverride()).to.be.equal(1);
    });
  });
  describe('repayDebt - when dust has increased', () => {
    it('success', async () => {
      // Collat amount in stable should be 4
      // So max borrowable amount is 2
      const collatAmount = parseUnits('2', collatBase);
      const borrowAmount = parseEther('2');
      await collateral.connect(alice).mint(alice.address, collatAmount);
      await collateral.connect(alice).approve(vaultManager.address, collatAmount);
      await angle(vaultManager, alice, [
        createVault(alice.address),
        createVault(alice.address),
        addCollateral(2, collatAmount),
      ]);

      await angle(vaultManager, alice, [borrow(2, borrowAmount)]);
      expect(await vaultManager.lastInterestAccumulatorUpdated()).to.be.equal(await latestTime());
      expect(await vaultManager.getVaultDebt(2)).to.be.equal(parseEther('2'));
      expect((await vaultManager.vaultData(2)).collateralAmount).to.be.equal(collatAmount);
      expect((await vaultManager.vaultData(2)).normalizedDebt).to.be.equal(borrowAmount);
      await expect(vaultManager.checkLiquidation(2, alice.address)).to.be.revertedWith('HealthyVault');
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('2'));
      // I can repay my debt when I have no dust
      await angle(vaultManager, alice, [repayDebt(2, parseEther('1.5'))]);
      expect((await vaultManager.vaultData(2)).collateralAmount).to.be.equal(collatAmount);
      expect((await vaultManager.vaultData(2)).normalizedDebt).to.be.equal(parseEther('0.5'));
      expect(await vaultManager.lastInterestAccumulatorUpdated()).to.be.equal(await latestTime());
      expect(await vaultManager.getVaultDebt(2)).to.be.equal(parseEther('0.5'));
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('0.5'));
      await vaultManager.connect(governor).setDusts(parseEther('1'), parseEther('1'));
      await expect(angle(vaultManager, alice, [repayDebt(2, parseEther('0.3'))])).to.be.revertedWith(
        'DustyLeftoverAmount',
      );
      await vaultManager.connect(governor).setDusts(parseEther('0.1'), parseEther('0.1'));
      await angle(vaultManager, alice, [repayDebt(2, parseEther('0.3'))]);
      expect((await vaultManager.vaultData(2)).collateralAmount).to.be.equal(collatAmount);
      expect((await vaultManager.vaultData(2)).normalizedDebt).to.be.equal(parseEther('0.2'));
      expect(await vaultManager.lastInterestAccumulatorUpdated()).to.be.equal(await latestTime());
      expect(await vaultManager.getVaultDebt(2)).to.be.equal(parseEther('0.2'));
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('0.2'));
      await vaultManager.connect(governor).setDusts(parseEther('1'), parseEther('1'));
      await expect(angle(vaultManager, alice, [repayDebt(2, parseEther('0.1'))])).to.be.revertedWith(
        'DustyLeftoverAmount',
      );
      // But you can still close the vault
      await angle(vaultManager, alice, [closeVault(2)]);
      expect((await vaultManager.vaultData(2)).normalizedDebt).to.be.equal(0);
      expect((await vaultManager.vaultData(2)).collateralAmount).to.be.equal(0);
      await expect(vaultManager.ownerOf(2)).to.be.revertedWith('NonexistentVault');
      expect(await collateral.balanceOf(alice.address)).to.be.equal(collatAmount);
      expect(await agToken.balanceOf(alice.address)).to.be.equal(0);
      expect(await vaultManager.totalNormalizedDebt()).to.be.equal(0);
      expect(await vaultManager.balanceOf(alice.address)).to.be.equal(1);
    });
  });
  describe('getDebtIn - with dust variations and cases', () => {
    it('success - when in a dust situation', async () => {
      const collatAmount = parseUnits('2', collatBase);
      const borrowAmount = parseEther('1.999');
      await collateral.connect(alice).mint(alice.address, collatAmount.mul(10));
      await collateral.connect(alice).approve(vaultManager.address, collatAmount.mul(10));
      await angle(vaultManager, alice, [
        createVault(alice.address),
        createVault(alice.address),
        addCollateral(2, collatAmount),
        borrow(2, borrowAmount),
        // Need to borrow from another vault
        addCollateral(1, collatAmount),
      ]);
      expectApprox(await vaultManager.getVaultDebt(2), parseEther('1.9989'), 0.1);
      const receipt = await (
        await angle(vaultManager, alice, [getDebtIn(1, vaultManager.address, 2, parseEther('1'))])
      ).wait();
      inReceipt(receipt, 'DebtTransferred', {
        srcVaultID: BigNumber.from(1),
        dstVaultID: BigNumber.from(2),
        dstVaultManager: vaultManager.address,
        amount: parseEther('1'),
      });
      expect(await vaultManager.lastInterestAccumulatorUpdated()).to.be.equal(await latestTime());
      expectApprox(await vaultManager.getVaultDebt(2), parseEther('1'), 0.1);
      expectApprox(await vaultManager.getVaultDebt(1), parseEther('1'), 0.1);
    });
  });
  describe('checkLiquidation - with dust variations and cases', () => {
    it('success - when in a dust situation', async () => {});
  });

  // TODO getDebtIn

  /*


  describe('getDebtIn', () => {
    it('success - same vaultManager', async () => {
      const collatAmount = parseUnits('2', collatBase);
      const borrowAmount = parseEther('1.999');
      await collateral.connect(alice).mint(alice.address, collatAmount.mul(10));
      await collateral.connect(alice).approve(vaultManager.address, collatAmount.mul(10));
      await angle(vaultManager, alice, [
        createVault(alice.address),
        createVault(alice.address),
        addCollateral(2, collatAmount),
        borrow(2, borrowAmount),
        // Need to borrow from another vault
        addCollateral(1, collatAmount),
      ]);
      expectApprox(await vaultManager.getVaultDebt(2), parseEther('1.9989'), 0.1);
      const receipt = await (
        await angle(vaultManager, alice, [getDebtIn(1, vaultManager.address, 2, parseEther('1'))])
      ).wait();
      inReceipt(receipt, 'DebtTransferred', {
        srcVaultID: BigNumber.from(1),
        dstVaultID: BigNumber.from(2),
        dstVaultManager: vaultManager.address,
        amount: parseEther('1'),
      });
      expect(await vaultManager.lastInterestAccumulatorUpdated()).to.be.equal(await latestTime());
      expectApprox(await vaultManager.getVaultDebt(2), parseEther('1'), 0.1);
      expectApprox(await vaultManager.getVaultDebt(1), parseEther('1'), 0.1);
    });
    it('success - different vaultManager contracts and similar borrow fee', async () => {
      const collatAmount = parseUnits('2', collatBase);
      const borrowAmount = parseEther('1.999');
      await collateral.connect(alice).mint(alice.address, collatAmount.mul(10));
      await collateral.connect(alice).approve(vaultManager.address, collatAmount.mul(10));
      await angle(vaultManager, alice, [
        createVault(alice.address),
        createVault(alice.address),
        addCollateral(1, collatAmount),
      ]);
      expect(await vaultManager.getVaultDebt(1)).to.be.equal(0);
      expect((await vaultManager.vaultData(1)).collateralAmount).to.be.equal(collatAmount);
      const vaultManager2 = (await deployUpgradeable(
        new VaultManagerLiquidationBoost__factory(deployer),
        0.1e9,
        0.1e9,
      )) as VaultManagerLiquidationBoost;
      await vaultManager2.initialize(treasury.address, collateral.address, oracle.address, params, 'USDC - 2/agEUR');
      await vaultManager2.connect(guardian).togglePause();
      await vaultManager2.connect(governor).setUint64(params.borrowFee, formatBytes32String('BF'));
      await treasury.setVaultManager2(vaultManager2.address);
      await treasury.addMinter(agToken.address, vaultManager2.address);
      await collateral.connect(alice).approve(vaultManager2.address, collatAmount.mul(10));
      await angle(vaultManager2, alice, [
        createVault(alice.address),
        addCollateral(1, collatAmount),
        borrow(1, borrowAmount),
      ]);
      expect(await vaultManager2.lastInterestAccumulatorUpdated()).to.be.equal(await latestTime());
      const surplusPre = await vaultManager.surplus();
      expectApprox(await vaultManager2.getVaultDebt(1), parseEther('1.9989'), 0.1);
      await angle(vaultManager, alice, [getDebtIn(1, vaultManager2.address, 1, parseEther('1'))]);
      expect(await vaultManager.lastInterestAccumulatorUpdated()).to.be.equal(await latestTime());
      expectApprox(await vaultManager2.getVaultDebt(1), parseEther('1'), 0.1);
      expectApprox(await vaultManager.getVaultDebt(1), parseEther('1'), 0.1);
      expect(await vaultManager.surplus()).to.be.equal(surplusPre);
    });
    it('success - different vaultManager contracts and different borrow fees', async () => {
      const collatAmount = parseUnits('2', collatBase);
      const borrowAmount = parseEther('1.999');
      await collateral.connect(alice).mint(alice.address, collatAmount.mul(10));
      await collateral.connect(alice).approve(vaultManager.address, collatAmount.mul(10));
      await angle(vaultManager, alice, [
        createVault(alice.address),
        createVault(alice.address),
        addCollateral(1, collatAmount),
      ]);
      expect(await vaultManager.getVaultDebt(1)).to.be.equal(0);
      expect((await vaultManager.vaultData(1)).collateralAmount).to.be.equal(collatAmount);
      const vaultManager2 = (await deployUpgradeable(
        new VaultManagerLiquidationBoost__factory(deployer),
        0.1e9,
        0.1e9,
      )) as VaultManagerLiquidationBoost;

      // 0 borrow fees in this case, which means 10% fees will be paid
      params.borrowFee = 0;
      await vaultManager2.initialize(treasury.address, collateral.address, oracle.address, params, 'USDC - 2/agEUR');
      params.borrowFee = 0.1e9;
      await vaultManager2.connect(guardian).togglePause();
      await treasury.setVaultManager2(vaultManager2.address);
      await treasury.addMinter(agToken.address, vaultManager2.address);
      await collateral.connect(alice).approve(vaultManager2.address, collatAmount.mul(10));

      await angle(vaultManager2, alice, [
        createVault(alice.address),
        addCollateral(1, collatAmount),
        borrow(1, borrowAmount),
      ]);
      expect(await vaultManager2.lastInterestAccumulatorUpdated()).to.be.equal(await latestTime());
      const surplusPre = await vaultManager2.surplus();
      expectApprox(await vaultManager2.getVaultDebt(1), parseEther('1.999'), 0.1);
      await angle(vaultManager, alice, [getDebtIn(1, vaultManager2.address, 1, parseEther('1'))]);
      expect(await vaultManager.lastInterestAccumulatorUpdated()).to.be.equal(await latestTime());
      expectApprox(await vaultManager2.getVaultDebt(1), parseEther('1.1'), 0.1);
      expectApprox(await vaultManager.getVaultDebt(1), parseEther('1'), 0.1);
      expectApprox(await vaultManager2.surplus(), surplusPre.add(parseEther('0.1')), 0.1);
    });
    it('success - same vaultManager and small borrow fee and repays all the debt', async () => {
      await vaultManager.connect(governor).setUint64(0.1e9, formatBytes32String('BF'));
      await vaultManager.connect(governor).setUint64(0, formatBytes32String('IR'));
      await vaultManager.connect(governor).setUint64(0.5e9, formatBytes32String('LS'));
      await vaultManager.connect(governor).setUint64(0, formatBytes32String('RF'));
      const collatAmount = parseUnits('10000', collatBase);
      const borrowAmount = parseEther('1');
      await collateral.connect(alice).mint(alice.address, collatAmount.mul(10));
      await collateral.connect(alice).approve(vaultManager.address, collatAmount.mul(10));
      await angle(vaultManager, alice, [
        createVault(alice.address),
        createVault(alice.address),
        addCollateral(2, collatAmount),
        borrow(2, borrowAmount),
        // Need to borrow from another vault
        addCollateral(1, collatAmount),
      ]);
      expectApprox(await vaultManager.getVaultDebt(2), parseEther('1'), 0.1);
      expectApprox(await agToken.balanceOf(alice.address), parseEther('0.9'), 0.1);
      await angle(vaultManager, alice, [getDebtIn(1, vaultManager.address, 2, parseEther('1'))]);
      expect(await vaultManager.lastInterestAccumulatorUpdated()).to.be.equal(await latestTime());
      expect(await vaultManager.getVaultDebt(2)).to.be.equal(0);
      expectApprox(await vaultManager.getVaultDebt(1), parseEther('1'), 0.1);
      expect(await vaultManager.surplus()).to.be.equal(parseEther('0.1').sub(1));
    });
    it('reverts - same vaultManager and small borrow fee but dust in the vault', async () => {
      await vaultManager.connect(governor).setUint64(0.1e9, formatBytes32String('BF'));
      await vaultManager.connect(governor).setUint64(0, formatBytes32String('IR'));
      await vaultManager.connect(governor).setUint64(0.5e9, formatBytes32String('LS'));
      await vaultManager.connect(governor).setUint64(0, formatBytes32String('RF'));
      const collatAmount = parseUnits('10000', collatBase);
      const borrowAmount = parseEther('1');
      await collateral.connect(alice).mint(alice.address, collatAmount.mul(10));
      await collateral.connect(alice).approve(vaultManager.address, collatAmount.mul(10));
      await angle(vaultManager, alice, [
        createVault(alice.address),
        createVault(alice.address),
        addCollateral(2, collatAmount),
        borrow(2, borrowAmount),
        // Need to borrow from another vault
        addCollateral(1, collatAmount),
      ]);
      expectApprox(await vaultManager.getVaultDebt(2), parseEther('1'), 0.1);
      expectApprox(await agToken.balanceOf(alice.address), parseEther('0.9'), 0.1);
      await expect(
        angle(vaultManager, alice, [getDebtIn(1, vaultManager.address, 2, parseEther('1').sub(1))]),
      ).to.be.revertedWith('DustyLeftoverAmount');
    });

    it('success - same vaultManager, no borrow fee but repay fee and nothing is done', async () => {
      await vaultManager.connect(governor).setUint64(0, formatBytes32String('BF'));
      await vaultManager.connect(governor).setUint64(0, formatBytes32String('IR'));
      await vaultManager.connect(governor).setUint64(0.5e9, formatBytes32String('LS'));
      await vaultManager.connect(governor).setUint64(0.1e9, formatBytes32String('RF'));
      const collatAmount = parseUnits('10000', collatBase);
      const borrowAmount = parseEther('1');
      await collateral.connect(alice).mint(alice.address, collatAmount.mul(10));
      await collateral.connect(alice).approve(vaultManager.address, collatAmount.mul(10));
      await angle(vaultManager, alice, [
        createVault(alice.address),
        createVault(alice.address),
        addCollateral(2, collatAmount),
        borrow(2, borrowAmount),
        // Need to borrow from another vault
        addCollateral(1, collatAmount),
      ]);
      expect(await vaultManager.surplus()).to.be.equal(parseEther('0'));
      expect(await vaultManager.getVaultDebt(2)).to.be.equal(parseEther('1').sub(1));
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('1').sub(1));
      await angle(vaultManager, alice, [getDebtIn(1, vaultManager.address, 2, parseEther('1'))]);
      expect(await vaultManager.lastInterestAccumulatorUpdated()).to.be.equal(await latestTime());
      expect(await vaultManager.getVaultDebt(2)).to.be.equal(parseEther('0'));
      expectApprox(await vaultManager.getVaultDebt(1), parseEther('1'), 0.1);
      expect(await vaultManager.surplus()).to.be.equal(0);
    });

    it('success - different vaultManagers, same borrow fee but repay fee higher in in vaultManager', async () => {
      await vaultManager.connect(governor).setUint64(0, formatBytes32String('BF'));
      await vaultManager.connect(governor).setUint64(0, formatBytes32String('IR'));
      await vaultManager.connect(governor).setUint64(0.5e9, formatBytes32String('LS'));
      await vaultManager.connect(governor).setUint64(0.1e9, formatBytes32String('RF'));
      const collatAmount = parseUnits('10000', collatBase);
      const borrowAmount = parseEther('1');
      await collateral.connect(alice).mint(alice.address, collatAmount.mul(10));
      await collateral.connect(alice).approve(vaultManager.address, collatAmount.mul(10));
      await angle(vaultManager, alice, [
        createVault(alice.address),
        createVault(alice.address),
        addCollateral(1, collatAmount),
      ]);
      expect(await vaultManager.getVaultDebt(1)).to.be.equal(0);
      expect((await vaultManager.vaultData(1)).collateralAmount).to.be.equal(collatAmount);
      const vaultManager2 = (await deployUpgradeable(
        new VaultManagerLiquidationBoost__factory(deployer),
        0.1e9,
        0.1e9,
      )) as VaultManagerLiquidationBoost;
      await vaultManager2.initialize(treasury.address, collateral.address, oracle.address, params, 'USDC - 2/agEUR');
      await vaultManager2.connect(guardian).togglePause();
      await treasury.setVaultManager2(vaultManager2.address);
      await treasury.addMinter(agToken.address, vaultManager2.address);
      await collateral.connect(alice).approve(vaultManager2.address, collatAmount.mul(10));
      await vaultManager2.connect(governor).setUint64(0, formatBytes32String('BF'));
      await vaultManager2.connect(governor).setUint64(0, formatBytes32String('IR'));
      await vaultManager2.connect(governor).setUint64(0.5e9, formatBytes32String('LS'));
      await vaultManager2.connect(governor).setUint64(0, formatBytes32String('RF'));
      await angle(vaultManager2, alice, [
        createVault(alice.address),
        addCollateral(1, collatAmount),
        borrow(1, borrowAmount),
      ]);
      expect(await vaultManager2.lastInterestAccumulatorUpdated()).to.be.equal(await latestTime());
      expectApprox(await vaultManager2.getVaultDebt(1), borrowAmount, 0.1);
      await angle(vaultManager, alice, [getDebtIn(1, vaultManager2.address, 1, parseEther('1'))]);
      expect(await vaultManager.lastInterestAccumulatorUpdated()).to.be.equal(await latestTime());
      expect(await vaultManager2.getVaultDebt(1)).to.be.equal(0);
      expectApprox(await vaultManager.getVaultDebt(1), parseEther('1'), 0.1);
      expect(await vaultManager2.surplus()).to.be.equal(0);
    });
    it('success - different vaultManagers, same borrow fee but repay fee higher in out vaultManager', async () => {
      await vaultManager.connect(governor).setUint64(0, formatBytes32String('BF'));
      await vaultManager.connect(governor).setUint64(0, formatBytes32String('IR'));
      await vaultManager.connect(governor).setUint64(0.5e9, formatBytes32String('LS'));
      await vaultManager.connect(governor).setUint64(0, formatBytes32String('RF'));
      const collatAmount = parseUnits('10000', collatBase);
      const borrowAmount = parseEther('1');
      await collateral.connect(alice).mint(alice.address, collatAmount.mul(10));
      await collateral.connect(alice).approve(vaultManager.address, collatAmount.mul(10));
      await angle(vaultManager, alice, [
        createVault(alice.address),
        createVault(alice.address),
        addCollateral(1, collatAmount),
      ]);
      expect(await vaultManager.getVaultDebt(1)).to.be.equal(0);
      expect((await vaultManager.vaultData(1)).collateralAmount).to.be.equal(collatAmount);
      const vaultManager2 = (await deployUpgradeable(
        new VaultManagerLiquidationBoost__factory(deployer),
        0.1e9,
        0.1e9,
      )) as VaultManagerLiquidationBoost;
      await vaultManager2.initialize(treasury.address, collateral.address, oracle.address, params, 'USDC - 2/agEUR');
      await vaultManager2.connect(guardian).togglePause();
      await treasury.setVaultManager2(vaultManager2.address);
      await treasury.addMinter(agToken.address, vaultManager2.address);
      await collateral.connect(alice).approve(vaultManager2.address, collatAmount.mul(10));
      await vaultManager2.connect(governor).setUint64(0, formatBytes32String('BF'));
      await vaultManager2.connect(governor).setUint64(0, formatBytes32String('IR'));
      await vaultManager2.connect(governor).setUint64(0.5e9, formatBytes32String('LS'));
      await vaultManager2.connect(governor).setUint64(0.1e9, formatBytes32String('RF'));
      await angle(vaultManager2, alice, [
        createVault(alice.address),
        addCollateral(1, collatAmount),
        borrow(1, borrowAmount),
      ]);
      expect(await vaultManager2.lastInterestAccumulatorUpdated()).to.be.equal(await latestTime());
      expectApprox(await vaultManager2.getVaultDebt(1), borrowAmount, 0.1);
      await angle(vaultManager, alice, [getDebtIn(1, vaultManager2.address, 1, parseEther('1'))]);
      expect(await vaultManager.lastInterestAccumulatorUpdated()).to.be.equal(await latestTime());
      expect(await vaultManager2.getVaultDebt(1)).to.be.equal(parseEther('0.1'));
      expectApprox(await vaultManager.getVaultDebt(1), parseEther('1'), 0.1);
      expect(await vaultManager2.surplus()).to.be.equal(parseEther('0.1'));
    });
    it('success - different vaultManagers, borrow fee and repay fee to be paid', async () => {
      await vaultManager.connect(governor).setUint64(0.5e9, formatBytes32String('BF'));
      await vaultManager.connect(governor).setUint64(0, formatBytes32String('IR'));
      await vaultManager.connect(governor).setUint64(0.5e9, formatBytes32String('LS'));
      await vaultManager.connect(governor).setUint64(0, formatBytes32String('RF'));
      const collatAmount = parseUnits('10000', collatBase);
      const borrowAmount = parseEther('1');
      await collateral.connect(alice).mint(alice.address, collatAmount.mul(10));
      await collateral.connect(alice).approve(vaultManager.address, collatAmount.mul(10));
      await angle(vaultManager, alice, [
        createVault(alice.address),
        createVault(alice.address),
        addCollateral(1, collatAmount),
      ]);
      expect(await vaultManager.getVaultDebt(1)).to.be.equal(0);
      expect((await vaultManager.vaultData(1)).collateralAmount).to.be.equal(collatAmount);
      const vaultManager2 = (await deployUpgradeable(
        new VaultManagerLiquidationBoost__factory(deployer),
        0.1e9,
        0.1e9,
      )) as VaultManagerLiquidationBoost;
      await vaultManager2.initialize(treasury.address, collateral.address, oracle.address, params, 'USDC - 2/agEUR');
      await vaultManager2.connect(guardian).togglePause();
      await treasury.setVaultManager2(vaultManager2.address);
      await treasury.addMinter(agToken.address, vaultManager2.address);
      await collateral.connect(alice).approve(vaultManager2.address, collatAmount.mul(10));
      await vaultManager2.connect(governor).setUint64(0, formatBytes32String('BF'));
      await vaultManager2.connect(governor).setUint64(0, formatBytes32String('IR'));
      await vaultManager2.connect(governor).setUint64(0.5e9, formatBytes32String('LS'));
      await vaultManager2.connect(governor).setUint64(0.1e9, formatBytes32String('RF'));
      await angle(vaultManager2, alice, [
        createVault(alice.address),
        addCollateral(1, collatAmount),
        borrow(1, borrowAmount),
      ]);
      expect(await vaultManager2.lastInterestAccumulatorUpdated()).to.be.equal(await latestTime());
      expectApprox(await vaultManager2.getVaultDebt(1), borrowAmount, 0.1);
      await angle(vaultManager, alice, [getDebtIn(1, vaultManager2.address, 1, parseEther('1'))]);
      // So here: you need to pay 50% borrow fee and on top of that 10% repay fee -> in the end it's 0.45 left
      expect(await vaultManager.lastInterestAccumulatorUpdated()).to.be.equal(await latestTime());
      expect(await vaultManager2.getVaultDebt(1)).to.be.equal(parseEther('0.55'));
      expectApprox(await vaultManager.getVaultDebt(1), parseEther('1'), 0.1);
      expect(await vaultManager2.surplus()).to.be.equal(parseEther('0.55'));
    });
  });
  describe('getDebtOut', () => {
    it('reverts - invalid sender', async () => {
      await expect(vaultManager.getDebtOut(1, 0, 0, 0)).to.be.revertedWith('NotVaultManager');
    });
    it('reverts - paused', async () => {
      const collatAmount = parseUnits('2', collatBase);
      const borrowAmount = parseEther('1.999');
      await collateral.connect(alice).mint(alice.address, collatAmount.mul(10));
      await collateral.connect(alice).approve(vaultManager.address, collatAmount.mul(10));
      await angle(vaultManager, alice, [
        createVault(alice.address),
        createVault(alice.address),
        addCollateral(1, collatAmount),
      ]);
      const vaultManager2 = (await deployUpgradeable(
        new VaultManagerLiquidationBoost__factory(deployer),
        0.1e9,
        0.1e9,
      )) as VaultManagerLiquidationBoost;
      await vaultManager2.initialize(treasury.address, collateral.address, oracle.address, params, 'USDC - 2/agEUR');
      await vaultManager2.connect(governor).togglePause();
      await vaultManager2.connect(governor).setUint64(params.borrowFee, formatBytes32String('BF'));
      await treasury.setVaultManager2(vaultManager2.address);
      await treasury.addMinter(agToken.address, vaultManager2.address);
      await collateral.connect(alice).approve(vaultManager2.address, collatAmount.mul(10));
      await angle(vaultManager2, alice, [
        createVault(alice.address),
        addCollateral(1, collatAmount),
        borrow(1, borrowAmount),
      ]);
      await vaultManager2.connect(governor).togglePause();
      await expect(
        angle(vaultManager, alice, [getDebtIn(1, vaultManager2.address, 1, parseEther('1'))]),
      ).to.be.revertedWith('Paused');
    });
  });

  describe('discount', () => {
    beforeEach(async () => {
      // Collat amount in stable should be 4
      // So max borrowable amount is 2
      const collatAmount = parseUnits('2', collatBase);
      const borrowAmount = parseEther('1');
      await collateral.connect(alice).mint(alice.address, collatAmount);
      await collateral.connect(alice).approve(vaultManager.address, collatAmount);
      await angle(vaultManager, alice, [
        createVault(alice.address),
        createVault(alice.address),
        addCollateral(2, collatAmount),
        borrow(2, borrowAmount),
      ]);
    });

    it('success - without boost', async () => {
      await oracle.update(parseEther('0.9'));
      // Health factor should be
      // `collateralAmountInStable * collateralFactor) / currentDebt`
      expect((await vaultManager.checkLiquidation(2, bob.address)).discount).to.be.equal(((2 * 0.9 * 0.5) / 1) * 1e9);
    });

    it('success - max discount', async () => {
      await oracle.update(parseEther('0.1'));
      expect((await vaultManager.checkLiquidation(2, bob.address)).discount).to.be.equal(
        1e9 - params.maxLiquidationDiscount,
      );
    });

    it('success - modified max discount', async () => {
      await vaultManager.connect(governor).setUint64(0.5e9, formatBytes32String('MLD'));
      await oracle.update(parseEther('0.1'));
      expect((await vaultManager.checkLiquidation(2, bob.address)).discount).to.be.equal(1e9 - 0.5e9);
    });

    it('success - modified base boost', async () => {
      await vaultManager.connect(governor).setLiquidationBoostParameters(ZERO_ADDRESS, [1e9], [0.5e9]);
      await oracle.update(parseEther('0.9'));
      expectApprox(
        (await vaultManager.checkLiquidation(2, bob.address)).discount,
        (1 - (1 - 2 * 0.9 * 0.5) * 0.5) * 1e9,
        0.0001,
      );
    });
    it('success - with a liquidation boost greater than the max value', async () => {
      const veBoost = (await new MockVeBoostProxy__factory(deployer).deploy()) as MockVeBoostProxy;
      await veBoost.setBalance(bob.address, 100);
      await vaultManager.connect(governor).setLiquidationBoostParameters(veBoost.address, [0, 50], [0.1e9, 0.2e9]);

      await oracle.update(parseEther('0.9'));
      expectApprox(
        (await vaultManager.checkLiquidation(2, bob.address)).discount,
        (1 - (1 - 2 * 0.9 * 0.5) * 0.2) * 1e9,
        0.0001,
      );
    });
    it('success - with a liquidation boost smaller than the min value', async () => {
      const veBoost = (await new MockVeBoostProxy__factory(deployer).deploy()) as MockVeBoostProxy;
      await veBoost.setBalance(bob.address, 10);
      await vaultManager.connect(governor).setLiquidationBoostParameters(veBoost.address, [20, 50], [0.2e9, 0.4e9]);

      await oracle.update(parseEther('0.9'));
      expectApprox(
        (await vaultManager.checkLiquidation(2, bob.address)).discount,
        (1 - (1 - 2 * 0.9 * 0.5) * 0.2) * 1e9,
        0.0001,
      );
    });
    it('success - with a liquidation boost in between', async () => {
      const veBoost = (await new MockVeBoostProxy__factory(deployer).deploy()) as MockVeBoostProxy;
      await veBoost.setBalance(bob.address, 50);
      await vaultManager.connect(governor).setLiquidationBoostParameters(veBoost.address, [0, 100], [0.1e9, 0.3e9]);

      await oracle.update(parseEther('0.9'));
      expectApprox(
        (await vaultManager.checkLiquidation(2, bob.address)).discount,
        (1 - (1 - 2 * 0.9 * 0.5) * 0.2) * 1e9,
        0.0001,
      );
    });
  });

  describe('liquidation', () => {
    const collatAmount = parseUnits('2', collatBase);
    const borrowAmount = parseEther('1');

    beforeEach(async () => {
      // Collat amount in stable should be 4
      // So max borrowable amount is 2
      await collateral.connect(alice).mint(alice.address, collatAmount);
      await collateral.connect(alice).approve(vaultManager.address, collatAmount);

      await stableMaster.connect(bob).mint(agToken.address, bob.address, borrowAmount);
      await agToken.connect(bob).approve(vaultManager.address, borrowAmount);

      await angle(vaultManager, alice, [
        createVault(alice.address),
        createVault(alice.address),
        addCollateral(2, collatAmount),
        borrow(2, borrowAmount),
      ]);
    });
    it('reverts - invalid amount length', async () => {
      await expect(
        vaultManager
          .connect(bob)
          ['liquidate(uint256[],uint256[],address,address)']([2, 0], [parseEther('1')], bob.address, bob.address),
      ).to.be.revertedWith('IncompatibleLengths');
    });
    it('reverts - zero length', async () => {
      await expect(
        vaultManager.connect(bob)['liquidate(uint256[],uint256[],address,address)']([], [], bob.address, bob.address),
      ).to.be.revertedWith('IncompatibleLengths');
    });
    it('reverts - paused', async () => {
      await vaultManager.connect(governor).togglePause();
      await expect(
        vaultManager.connect(bob)['liquidate(uint256[],uint256[],address,address)']([1], [1], bob.address, bob.address),
      ).to.be.revertedWith('Paused');
      await expect(
        vaultManager
          .connect(bob)
          ['liquidate(uint256[],uint256[],address,address,address,bytes)'](
            [1],
            [1],
            bob.address,
            bob.address,
            ZERO_ADDRESS,
            '0x',
          ),
      ).to.be.revertedWith('Paused');
    });
    it('success - no liquidation boost', async () => {
      const rate = 0.99;
      await oracle.update(parseEther(rate.toString()));

      // Target health factor is 1.1
      // discount: `collateralAmountInStable * collateralFactor) / currentDebt`
      const discount = (2 * rate * 0.5) / 1;
      const maxStablecoinAmountToRepay = (1.1 - rate * 2 * 0.5) / (0.9 * 1.1 - 0.5 / discount);

      await displayVaultState(vaultManager, 2, log, collatBase);

      expectApprox(
        (await vaultManager.checkLiquidation(2, bob.address)).maxStablecoinAmountToRepay,
        parseEther(maxStablecoinAmountToRepay.toString()),
        0.0001,
      );
      expectApprox(
        (await vaultManager.checkLiquidation(2, bob.address)).maxCollateralAmountGiven,
        parseUnits((maxStablecoinAmountToRepay / rate / discount).toFixed(10), collatBase),
        0.0001,
      );

      const receipt = await (
        await vaultManager
          .connect(bob)
          ['liquidate(uint256[],uint256[],address,address)'](
            [2],
            [parseEther(maxStablecoinAmountToRepay.toString())],
            bob.address,
            bob.address,
          )
      ).wait();

      inReceipt(receipt, 'LiquidatedVaults', {
        vaultIDs: [BigNumber.from(2)],
      });

      await displayVaultState(vaultManager, 2, log, collatBase);

      await expect(vaultManager.checkLiquidation(2, bob.address)).to.be.reverted;
      expectApprox(
        await vaultManager.totalNormalizedDebt(),
        borrowAmount.sub(parseEther(maxStablecoinAmountToRepay.toString()).mul(params.liquidationSurcharge).div(1e9)),
        0.001,
      );
    });
    it('success - no liquidation boost and base swapper contract', async () => {
      const rate = 0.99;
      await oracle.update(parseEther(rate.toString()));

      // Target health factor is 1.1
      // discount: `collateralAmountInStable * collateralFactor) / currentDebt`
      const discount = (2 * rate * 0.5) / 1;
      const maxStablecoinAmountToRepay = (1.1 - rate * 2 * 0.5) / (0.9 * 1.1 - 0.5 / discount);
      mockSwapper = (await new MockSwapper__factory(deployer).deploy()) as MockSwapper;
      await displayVaultState(vaultManager, 2, log, collatBase);

      expectApprox(
        (await vaultManager.checkLiquidation(2, bob.address)).maxStablecoinAmountToRepay,
        parseEther(maxStablecoinAmountToRepay.toString()),
        0.0001,
      );
      expectApprox(
        (await vaultManager.checkLiquidation(2, bob.address)).maxCollateralAmountGiven,
        parseUnits((maxStablecoinAmountToRepay / rate / discount).toFixed(10), collatBase),
        0.0001,
      );

      const receipt = await (
        await vaultManager
          .connect(bob)
          ['liquidate(uint256[],uint256[],address,address,address,bytes)'](
            [2],
            [parseEther(maxStablecoinAmountToRepay.toString())],
            bob.address,
            bob.address,
            mockSwapper.address,
            web3.utils.keccak256('test'),
          )
      ).wait();
      expect(await mockSwapper.counter()).to.be.equal(1);

      inReceipt(receipt, 'LiquidatedVaults', {
        vaultIDs: [BigNumber.from(2)],
      });

      await displayVaultState(vaultManager, 2, log, collatBase);

      await expect(vaultManager.checkLiquidation(2, bob.address)).to.be.reverted;
      expectApprox(
        await vaultManager.totalNormalizedDebt(),
        borrowAmount.sub(parseEther(maxStablecoinAmountToRepay.toString()).mul(params.liquidationSurcharge).div(1e9)),
        0.001,
      );
    });
    it('success - no liquidation boost and more advanced swapper contract', async () => {
      const rate = 0.99;
      await oracle.update(parseEther(rate.toString()));

      // Target health factor is 1.1
      // discount: `collateralAmountInStable * collateralFactor) / currentDebt`
      const discount = (2 * rate * 0.5) / 1;
      const maxStablecoinAmountToRepay = (1.1 - rate * 2 * 0.5) / (0.9 * 1.1 - 0.5 / discount);
      mockSwapperWithSwap = (await new MockSwapperWithSwap__factory(deployer).deploy()) as MockSwapperWithSwap;
      await treasury.connect(alice).addMinter(agToken.address, alice.address);
      await agToken.connect(alice).mint(mockSwapperWithSwap.address, parseEther('10'));

      await displayVaultState(vaultManager, 2, log, collatBase);

      expectApprox(
        (await vaultManager.checkLiquidation(2, bob.address)).maxStablecoinAmountToRepay,
        parseEther(maxStablecoinAmountToRepay.toString()),
        0.0001,
      );
      expectApprox(
        (await vaultManager.checkLiquidation(2, bob.address)).maxCollateralAmountGiven,
        parseUnits((maxStablecoinAmountToRepay / rate / discount).toFixed(10), collatBase),
        0.0001,
      );

      const receipt = await (
        await vaultManager
          .connect(bob)
          ['liquidate(uint256[],uint256[],address,address,address,bytes)'](
            [2],
            [parseEther(maxStablecoinAmountToRepay.toString())],
            bob.address,
            mockSwapperWithSwap.address,
            mockSwapperWithSwap.address,
            web3.utils.keccak256('test'),
          )
      ).wait();
      expect(await mockSwapperWithSwap.counter()).to.be.equal(1);
      expectApprox(
        await agToken.balanceOf(mockSwapperWithSwap.address),
        parseEther('10').sub(parseEther(maxStablecoinAmountToRepay.toString())),
        0.1,
      );

      inReceipt(receipt, 'LiquidatedVaults', {
        vaultIDs: [BigNumber.from(2)],
      });

      await displayVaultState(vaultManager, 2, log, collatBase);

      await expect(vaultManager.checkLiquidation(2, bob.address)).to.be.reverted;
      expectApprox(
        await vaultManager.totalNormalizedDebt(),
        borrowAmount.sub(parseEther(maxStablecoinAmountToRepay.toString()).mul(params.liquidationSurcharge).div(1e9)),
        0.001,
      );
    });
    it('success - case 2 without boost', async () => {
      const rate = 0.9;
      await oracle.update(parseEther(rate.toString()));

      // Target health factor is 1.1
      // discount: `collateralAmountInStable * collateralFactor) / currentDebt`
      const discount = (2 * rate * 0.5) / 1;
      const maxStablecoinAmountToRepay = (1.1 - rate * 2 * 0.5) / (0.9 * 1.1 - 0.5 / discount);

      await displayVaultState(vaultManager, 2, log, collatBase);

      expectApprox(
        (await vaultManager.checkLiquidation(2, bob.address)).maxStablecoinAmountToRepay,
        parseEther(maxStablecoinAmountToRepay.toString()),
        0.0001,
      );
      expectApprox(
        (await vaultManager.checkLiquidation(2, bob.address)).maxCollateralAmountGiven,
        parseUnits((maxStablecoinAmountToRepay / rate / discount).toFixed(10), collatBase),
        0.0001,
      );

      await vaultManager
        .connect(bob)
        ['liquidate(uint256[],uint256[],address,address)'](
          [2],
          [parseEther(maxStablecoinAmountToRepay.toString())],
          bob.address,
          bob.address,
        );

      await displayVaultState(vaultManager, 2, log, collatBase);

      await expect(vaultManager.checkLiquidation(2, bob.address)).to.be.reverted;
      expectApprox(
        await vaultManager.totalNormalizedDebt(),
        borrowAmount.sub(parseEther(maxStablecoinAmountToRepay.toString()).mul(params.liquidationSurcharge).div(1e9)),
        0.001,
      );
    });

    it('success - max discount', async () => {
      const rate = 0.85;
      await oracle.update(parseEther(rate.toString()));

      // This time discount is maxed
      const discount = Math.max((2 * rate * 0.5) / 1, 0.9);
      const maxStablecoinAmountToRepay = (1.1 - rate * 2 * 0.5) / (0.9 * 1.1 - 0.5 / discount);

      await displayVaultState(vaultManager, 2, log, collatBase);

      expectApprox(
        (await vaultManager.checkLiquidation(2, bob.address)).maxStablecoinAmountToRepay,
        parseEther(maxStablecoinAmountToRepay.toString()),
        0.0001,
      );
      expectApprox(
        (await vaultManager.checkLiquidation(2, bob.address)).maxCollateralAmountGiven,
        parseUnits((maxStablecoinAmountToRepay / rate / discount).toFixed(10), collatBase),
        0.0001,
      );

      await vaultManager
        .connect(bob)
        ['liquidate(uint256[],uint256[],address,address)'](
          [2],
          [parseEther(maxStablecoinAmountToRepay.toString())],
          bob.address,
          bob.address,
        );

      await displayVaultState(vaultManager, 2, log, collatBase);

      await expect(vaultManager.checkLiquidation(2, bob.address)).to.be.reverted;
      expectApprox(
        await vaultManager.totalNormalizedDebt(),
        borrowAmount.sub(parseEther(maxStablecoinAmountToRepay.toString()).mul(params.liquidationSurcharge).div(1e9)),
        0.001,
      );
    });

    it('success - vault has to be emptied', async () => {
      const rate = 0.5;
      await oracle.update(parseEther(rate.toString()));

      // In this case, vault cannot be brought in a healthy pos
      // Limit is `healthFactor * liquidationDiscount * surcharge >= collateralFactor`

      await displayVaultState(vaultManager, 2, log, collatBase);

      const discount = Math.max((2 * rate * 0.5) / 1, 0.9);
      const maxStablecoinAmountToRepay = rate * 2 * discount;

      expect((await vaultManager.checkLiquidation(2, bob.address)).thresholdRepayAmount).gt(0);
      expectApprox(
        (await vaultManager.checkLiquidation(2, bob.address)).maxStablecoinAmountToRepay,
        parseEther(maxStablecoinAmountToRepay.toString()),
        0.0001,
      );
      expectApprox(
        (await vaultManager.checkLiquidation(2, bob.address)).maxCollateralAmountGiven,
        collatAmount,
        0.0001,
      );

      await vaultManager
        .connect(bob)
        ['liquidate(uint256[],uint256[],address,address)'](
          [2],
          [parseEther(maxStablecoinAmountToRepay.toString())],
          bob.address,
          bob.address,
        );

      await displayVaultState(vaultManager, 2, log, collatBase);

      await expect(vaultManager.checkLiquidation(2, bob.address)).to.be.reverted;
      expect(await vaultManager.totalNormalizedDebt()).to.be.equal(0);
    });

    it('success - dust collateral limit', async () => {
      const rate = 0.5;
      await oracle.update(parseEther(rate.toString()));

      // In this case, vault cannot be brought in a healthy pos
      // Limit is `healthFactor * liquidationDiscount * surcharge >= collateralFactor`

      await displayVaultState(vaultManager, 2, log, collatBase);

      const discount = Math.max((2 * rate * 0.5) / 1, 0.9);
      const maxStablecoinAmountToRepay = rate * 2 * discount;

      expectApprox(
        (await vaultManager.checkLiquidation(2, bob.address)).maxStablecoinAmountToRepay,
        parseEther(maxStablecoinAmountToRepay.toString()),
        0.0001,
      );
      expectApprox(
        (await vaultManager.checkLiquidation(2, bob.address)).maxCollateralAmountGiven,
        collatAmount,
        0.0001,
      );

      await vaultManager
        .connect(bob)
        ['liquidate(uint256[],uint256[],address,address)'](
          [2],
          [parseEther(maxStablecoinAmountToRepay.toString())],
          bob.address,
          bob.address,
        );

      await displayVaultState(vaultManager, 2, log, collatBase);

      await expect(vaultManager.checkLiquidation(2, bob.address)).to.be.reverted;
      expect(await vaultManager.totalNormalizedDebt()).to.be.equal(0);
    });

    it('success - dust collateral amount from start', async () => {
      const rate = 0.01;
      await oracle.update(parseEther(rate.toString()));

      // In this case, vault cannot be brought in a healthy pos
      // Limit is `healthFactor * liquidationDiscount * surcharge >= collateralFactor`

      await displayVaultState(vaultManager, 2, log, collatBase);

      const discount = Math.max((2 * rate * 0.5) / 1, 0.9);
      const maxStablecoinAmountToRepay = rate * 2 * discount;

      expectApprox(
        (await vaultManager.checkLiquidation(2, bob.address)).maxStablecoinAmountToRepay,
        parseEther(maxStablecoinAmountToRepay.toString()),
        0.0001,
      );
      expectApprox(
        (await vaultManager.checkLiquidation(2, bob.address)).thresholdRepayAmount,
        parseEther(maxStablecoinAmountToRepay.toString()),
        0.0001,
      );
      expectApprox(
        (await vaultManager.checkLiquidation(2, bob.address)).maxCollateralAmountGiven,
        collatAmount,
        0.0001,
      );

      await vaultManager
        .connect(bob)
        ['liquidate(uint256[],uint256[],address,address)'](
          [2],
          [(await vaultManager.checkLiquidation(2, bob.address)).maxStablecoinAmountToRepay],
          bob.address,
          bob.address,
        );

      await displayVaultState(vaultManager, 2, log, collatBase);

      await expect(vaultManager.checkLiquidation(2, bob.address)).to.be.reverted;
      expect(await vaultManager.totalNormalizedDebt()).to.be.equal(0);
    });
  });
  describe('getTotalDebt', () => {
    const collatAmount = parseUnits('2', collatBase);
    const borrowAmount = parseEther('1');

    beforeEach(async () => {
      // Collat amount in stable should be 4
      // So max borrowable amount is 1
      await collateral.connect(alice).mint(alice.address, collatAmount);
      await collateral.connect(alice).approve(vaultManager.address, collatAmount);
      await angle(vaultManager, alice, [
        createVault(alice.address),
        addCollateral(1, collatAmount),
        borrow(1, borrowAmount),
      ]);
    });

    it('success - one year', async () => {
      const debt = await vaultManager.getTotalDebt();

      await displayVaultState(vaultManager, 1, log, collatBase);

      await increaseTime(24 * 3600 * 365);

      await displayVaultState(vaultManager, 1, log, collatBase);

      expectApprox(await vaultManager.getTotalDebt(), debt.mul(yearlyRate * 100).div(100), 0.001);
    });
    it('success - ratePerSecond is 0', async () => {
      const debt = await vaultManager.getTotalDebt();
      await vaultManager.connect(governor).setUint64(0, formatBytes32String('IR'));

      await increaseTime(1000);

      expectApprox(await vaultManager.getTotalDebt(), debt, 0.001);
    });
    it('success - one year and interest rate accrue', async () => {
      const debt = await vaultManager.getTotalDebt();

      await displayVaultState(vaultManager, 1, log, collatBase);

      await increaseTime(24 * 3600 * 365);
      await vaultManager
        .connect(governor)
        .setUint64(parseUnits(ratePerSecond.toFixed(27), 27), formatBytes32String('IR'));
      // 15% of borrow amount after a year
      expectApprox(await vaultManager.surplus(), parseEther('0.15'), 0.01);
      expectApprox(await vaultManager.interestAccumulator(), parseUnits('1.05', 27), 0.001);

      await displayVaultState(vaultManager, 1, log, collatBase);

      expectApprox(await vaultManager.getTotalDebt(), debt.mul(yearlyRate * 100).div(100), 0.001);
    });
    it('success - 10 years and interest rate accrue', async () => {
      const debt = await vaultManager.getTotalDebt();

      await displayVaultState(vaultManager, 1, log, collatBase);

      await increaseTime(24 * 3600 * 365 * 10);
      await vaultManager
        .connect(governor)
        .setUint64(parseUnits(ratePerSecond.toFixed(27), 27), formatBytes32String('IR'));
      // 10% of borrow amount after a year + 5% compounded for 10 years which makes 0.1 + 0.628

      expectApprox(await vaultManager.surplus(), parseEther('0.7278'), 0.01);
      expectApprox(await vaultManager.interestAccumulator(), parseUnits('1.6278', 27), 0.01);

      await displayVaultState(vaultManager, 1, log, collatBase);

      expectApprox(await vaultManager.getTotalDebt(), debt.mul(162789 * 100).div(10000000), 0.01);
    });
  });
  describe('liquidation with dust', () => {
    const collatAmount = parseUnits('2', collatBase);
    const borrowAmount = parseEther('1');
    beforeEach(async () => {
      vaultManager = (await deployUpgradeable(
        new VaultManagerLiquidationBoost__factory(deployer),
        parseEther('0.5'),
        parseEther('0.5'),
      )) as VaultManagerLiquidationBoost;

      await treasury.addMinter(agToken.address, vaultManager.address);
      params.interestRate = parseEther('0');
      params.borrowFee = 0;
      await vaultManager.initialize(treasury.address, collateral.address, oracle.address, params, 'USDC/agEUR');
      await vaultManager.connect(guardian).togglePause();
      await treasury.setVaultManager2(vaultManager.address);
      await treasury.addMinter(agToken.address, vaultManager.address);
      await collateral.connect(alice).mint(alice.address, collatAmount.mul(100));
      await collateral.connect(alice).approve(vaultManager.address, collatAmount.mul(100));

      await stableMaster.connect(bob).mint(agToken.address, bob.address, borrowAmount.mul(100));
      await agToken.connect(bob).approve(vaultManager.address, borrowAmount.mul(100));

      await angle(vaultManager, alice, [
        createVault(alice.address),
        createVault(alice.address),
        addCollateral(2, collatAmount),
        borrow(2, borrowAmount),
      ]);
    });
    it('success - max amount to repay is changed because of dust', async () => {
      vaultManager = (await deployUpgradeable(
        new VaultManagerLiquidationBoost__factory(deployer),
        parseEther('0.5'),
        parseEther('0.5'),
      )) as VaultManagerLiquidationBoost;

      await treasury.addMinter(agToken.address, vaultManager.address);
      params.interestRate = parseEther('0');
      params.borrowFee = 0;
      await vaultManager.initialize(treasury.address, collateral.address, oracle.address, params, 'USDC/agEUR');
      await vaultManager.connect(guardian).togglePause();
      await treasury.setVaultManager2(vaultManager.address);
      await treasury.addMinter(agToken.address, vaultManager.address);
      await collateral.connect(alice).mint(alice.address, collatAmount.mul(100));
      await collateral.connect(alice).approve(vaultManager.address, collatAmount.mul(100));

      await stableMaster.connect(bob).mint(agToken.address, bob.address, borrowAmount.mul(100));
      await agToken.connect(bob).approve(vaultManager.address, borrowAmount.mul(100));

      await angle(vaultManager, alice, [
        createVault(alice.address),
        createVault(alice.address),
        addCollateral(2, collatAmount),
        borrow(2, borrowAmount),
      ]);
      const rate = 0.85;
      await oracle.update(parseEther(rate.toString()));

      // This time discount is maxed
      const discount = Math.max((2 * rate * 0.5) / 1, 0.9);
      const maxStablecoinAmountToRepay = (1.1 - rate * 2 * 0.5) / (0.9 * 1.1 - 0.5 / discount);

      await displayVaultState(vaultManager, 2, log, collatBase);

      expectApprox(
        (await vaultManager.checkLiquidation(2, bob.address)).maxStablecoinAmountToRepay,
        borrowAmount.mul(1e9).div(params.liquidationSurcharge),
        0.0001,
      );
      expectApprox(
        (await vaultManager.checkLiquidation(2, bob.address)).thresholdRepayAmount,
        borrowAmount.sub(parseEther('0.5')).mul(1e9).div(params.liquidationSurcharge),
        0.0001,
      );

      await vaultManager
        .connect(bob)
        ['liquidate(uint256[],uint256[],address,address)'](
          [2],
          [parseEther(maxStablecoinAmountToRepay.toString())],
          bob.address,
          bob.address,
        );

      await displayVaultState(vaultManager, 2, log, collatBase);

      await expect(vaultManager.checkLiquidation(2, bob.address)).to.be.reverted;
      expect(await vaultManager.totalNormalizedDebt()).to.be.equal(0);
    });
    it('success - max amount to repay is changed because of dust and for unhealthy collateral with bad debt', async () => {
      // The dust amount of collateral is 0.5, so we'll fall below it
      const rate = 0.01;
      await oracle.update(parseEther(rate.toString()));

      await displayVaultState(vaultManager, 2, log, collatBase);

      const discount = Math.max((2 * rate * 0.5) / 1, 0.9);
      const maxStablecoinAmountToRepay = rate * 2 * discount;

      expectApprox(
        (await vaultManager.checkLiquidation(2, bob.address)).maxStablecoinAmountToRepay,
        parseEther(maxStablecoinAmountToRepay.toString()),
        0.0001,
      );
      expectApprox(
        (await vaultManager.checkLiquidation(2, bob.address)).thresholdRepayAmount,
        parseEther(maxStablecoinAmountToRepay.toString()),
        0.0001,
      );
      expectApprox(
        (await vaultManager.checkLiquidation(2, bob.address)).maxCollateralAmountGiven,
        collatAmount,
        0.0001,
      );
      await vaultManager
        .connect(bob)
        ['liquidate(uint256[],uint256[],address,address)'](
          [2],
          [(await vaultManager.checkLiquidation(2, bob.address)).maxStablecoinAmountToRepay],
          bob.address,
          bob.address,
        );

      await displayVaultState(vaultManager, 2, log, collatBase);

      await expect(vaultManager.checkLiquidation(2, bob.address)).to.be.reverted;
      // In this case there should be bad debt, and it should be equal to the current debt minus what has been repaid
      expectApprox(
        await vaultManager.badDebt(),
        borrowAmount.sub(parseEther((maxStablecoinAmountToRepay * 0.9).toString())),
        0.001,
      );
      expect(await vaultManager.totalNormalizedDebt()).to.be.equal(0);
    });
  });
  */
});
