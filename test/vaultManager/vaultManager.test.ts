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
  MockRepayCallee,
  MockRepayCallee__factory,
  MockStableMaster,
  MockStableMaster__factory,
  MockToken,
  MockToken__factory,
  MockTreasury,
  MockTreasury__factory,
  MockVeBoostProxy,
  MockVeBoostProxy__factory,
  VaultManager,
  VaultManager__factory,
} from '../../typechain';
import { expect } from '../utils/chai-setup';
import { inIndirectReceipt } from '../utils/expectEvent';
import {
  addCollateral,
  angle,
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

contract('VaultManager', () => {
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
  let mockRepayCallee: MockRepayCallee;

  const impersonatedSigners: { [key: string]: Signer } = {};

  const collatBase = 10;
  const yearlyRate = 1.05;
  const ratePerSecond = yearlyRate ** (1 / (365 * 24 * 3600)) - 1;
  const params = {
    debtCeiling: parseEther('100'),
    collateralFactor: 0.5e9,
    targetHealthFactor: 1.1e9,
    borrowFee: 0.1e9,
    interestRate: parseUnits(ratePerSecond.toFixed(27), 27),
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

    oracle = await new MockOracle__factory(deployer).deploy(parseUnits('2', 18), collatBase, treasury.address);
    await vaultManager.initialize(treasury.address, collateral.address, oracle.address, params, 'USDC/agEUR');
    await vaultManager.connect(guardian).togglePause();
  });
  describe('oracle', () => {
    it('success - read', async () => {
      const oracle = (await ethers.getContractAt(Oracle__factory.abi, await vaultManager.oracle())) as Oracle;
      expect(await oracle.read()).to.be.equal(parseUnits('2', 18));
    });
  });

  describe('createVault', () => {
    it('reverts - paused', async () => {
      await vaultManager.connect(guardian).togglePause();
      await expect(vaultManager.createVault(alice.address)).to.be.revertedWith('42');
    });

    it('success', async () => {
      await vaultManager.createVault(alice.address);
      expect(await vaultManager.ownerOf(1)).to.be.equal(alice.address);
      expect(await vaultManager.balanceOf(alice.address)).to.be.equal(1);
    });
  });

  describe('angle', () => {
    it('reverts - paused', async () => {
      await vaultManager.connect(guardian).togglePause();
      await expect(angle(vaultManager, alice, [createVault(alice.address)])).to.be.revertedWith('42');
    });

    it('success - state', async () => {
      await angle(vaultManager, alice, [createVault(alice.address), createVault(alice.address)]);
      expect(await vaultManager.balanceOf(alice.address)).to.be.equal(2);
      expect(await vaultManager.ownerOf(1)).to.be.equal(alice.address);
      expect(await vaultManager.ownerOf(2)).to.be.equal(alice.address);
    });

    it('reverts - not whitelisted', async () => {
      await vaultManager.connect(governor).toggleWhitelisting();
      await expect(angle(vaultManager, alice, [createVault(alice.address)])).to.be.revertedWith('20');
    });
    it('reverts - unknown action', async () => {
      await expect(
        vaultManager
          .connect(governor)
          ['angle(uint8[],bytes[],address,address)']([10], ['0x'], ZERO_ADDRESS, ZERO_ADDRESS),
      ).to.be.reverted;
    });

    it('success - whitelisted', async () => {
      await vaultManager.connect(governor).toggleWhitelisting();
      await vaultManager.connect(governor).toggleWhitelist(alice.address);
      await angle(vaultManager, alice, [createVault(alice.address), createVault(alice.address)]);
      expect(await vaultManager.balanceOf(alice.address)).to.be.equal(2);
      expect(await vaultManager.ownerOf(1)).to.be.equal(alice.address);
      expect(await vaultManager.ownerOf(2)).to.be.equal(alice.address);
    });
  });
  describe('closeVault', () => {
    it('reverts - should be liquidated', async () => {
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
      await oracle.update(parseEther('0.9'));
      await expect(angle(vaultManager, alice, [closeVault(2)])).to.be.revertedWith('21');
    });
  });

  describe('addCollateral', () => {
    it('success', async () => {
      const amount = parseUnits('1', collatBase);
      await collateral.connect(alice).mint(alice.address, amount);
      await collateral.connect(alice).approve(vaultManager.address, amount);
      await angle(vaultManager, alice, [
        createVault(alice.address),
        createVault(alice.address),
        addCollateral(2, amount),
      ]);
      expect(await collateral.balanceOf(alice.address)).to.be.equal(0);
      expect(await collateral.balanceOf(vaultManager.address)).to.be.equal(amount);
      expect((await vaultManager.vaultData(2)).collateralAmount).to.be.equal(amount);
    });

    it('success - twice', async () => {
      const amount = parseUnits('1', collatBase);
      await collateral.connect(alice).mint(alice.address, amount);
      await collateral.connect(alice).approve(vaultManager.address, amount);
      await angle(vaultManager, alice, [
        createVault(alice.address),
        createVault(alice.address),
        addCollateral(2, amount),
      ]);
      expect(await collateral.balanceOf(alice.address)).to.be.equal(0);
      expect(await collateral.balanceOf(vaultManager.address)).to.be.equal(amount);

      const amount2 = parseUnits('3', collatBase);
      await collateral.connect(alice).mint(alice.address, amount2);
      await collateral.connect(alice).approve(vaultManager.address, amount2);
      await angle(vaultManager, alice, [addCollateral(1, amount2)]);
      expect(await collateral.balanceOf(alice.address)).to.be.equal(0);
      expect(await collateral.balanceOf(vaultManager.address)).to.be.equal(amount.add(amount2));
      expect((await vaultManager.vaultData(1)).collateralAmount).to.be.equal(amount2);
    });
  });

  describe('removeCollateral', () => {
    it('success - collateral removed', async () => {
      const amount = parseUnits('1', collatBase);
      await collateral.connect(alice).mint(alice.address, amount);
      await collateral.connect(alice).approve(vaultManager.address, amount);
      await angle(vaultManager, alice, [
        createVault(alice.address),
        createVault(alice.address),
        addCollateral(2, amount),
      ]);
      expect(await collateral.balanceOf(alice.address)).to.be.equal(0);
      expect(await collateral.balanceOf(vaultManager.address)).to.be.equal(amount);
      await angle(vaultManager, alice, [removeCollateral(2, amount)]);
      expect((await vaultManager.vaultData(2)).collateralAmount).to.be.equal(0);
    });
    it('reverts - insolvent vault', async () => {
      const amount = parseUnits('1', collatBase);
      const borrowAmount = parseEther('0.999');
      await collateral.connect(alice).mint(alice.address, amount);
      await collateral.connect(alice).approve(vaultManager.address, amount);
      await angle(vaultManager, alice, [
        createVault(alice.address),
        createVault(alice.address),
        addCollateral(2, amount),
        borrow(2, borrowAmount),
      ]);
      await expect(angle(vaultManager, alice, [removeCollateral(2, parseUnits('0.5', collatBase))])).to.be.revertedWith(
        '21',
      );
    });
  });

  describe('borrow', () => {
    it('reverts - limit CF', async () => {
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

      await expect(angle(vaultManager, alice, [borrow(2, borrowAmount)])).to.be.revertedWith('21');
    });
    it('reverts - dusty amount', async () => {
      // Collat amount in stable should be 4
      // So max borrowable amount is 2
      const collatAmount = parseUnits('2', collatBase);
      await collateral.connect(alice).mint(alice.address, collatAmount);
      await collateral.connect(alice).approve(vaultManager.address, collatAmount);
      await angle(vaultManager, alice, [
        createVault(alice.address),
        createVault(alice.address),
        addCollateral(2, collatAmount),
      ]);

      await expect(angle(vaultManager, alice, [borrow(2, parseUnits('0.01', 9))])).to.be.revertedWith('24');
    });
    it('reverts - debt ceiling amount', async () => {
      // Collat amount in stable should be 4
      // So max borrowable amount is 2
      const collatAmount = parseUnits('10000', collatBase);
      await collateral.connect(alice).mint(alice.address, collatAmount);
      await collateral.connect(alice).approve(vaultManager.address, collatAmount);
      await angle(vaultManager, alice, [
        createVault(alice.address),
        createVault(alice.address),
        addCollateral(2, collatAmount),
      ]);
      await expect(angle(vaultManager, alice, [borrow(2, parseEther('101'))])).to.be.revertedWith('45');
    });

    it('success - in two transactions', async () => {
      // Collat amount in stable should be 4
      // So max borrowable amount is 2
      const collatAmount = parseUnits('2', collatBase);
      const borrowAmount = parseEther('1.999');
      await collateral.connect(alice).mint(alice.address, collatAmount);
      await collateral.connect(alice).approve(vaultManager.address, collatAmount);
      await angle(vaultManager, alice, [
        createVault(alice.address),
        createVault(alice.address),
        addCollateral(2, collatAmount),
      ]);

      await angle(vaultManager, alice, [borrow(2, borrowAmount)]);
      expectApprox(await vaultManager.getVaultDebt(2), parseEther('1.9989'), 0.1);
      expectApprox(await vaultManager.surplus(), parseEther('0.19989'), 0.01);
      await expect(vaultManager.checkLiquidation(2, alice.address)).to.be.revertedWith('44');
    });
    it('success - in just one transaction', async () => {
      // Collat amount in stable should be 4
      // So max borrowable amount is 2
      const collatAmount = parseUnits('2', collatBase);
      const borrowAmount = parseEther('1.999');
      await collateral.connect(alice).mint(alice.address, collatAmount);
      await collateral.connect(alice).approve(vaultManager.address, collatAmount);
      await angle(vaultManager, alice, [
        createVault(alice.address),
        createVault(alice.address),
        addCollateral(2, collatAmount),
        borrow(2, borrowAmount),
      ]);

      expectApprox(await vaultManager.getVaultDebt(2), parseEther('1.9989'), 0.1);
      expectApprox(await vaultManager.surplus(), parseEther('0.19989'), 0.01);
      await expect(vaultManager.checkLiquidation(2, alice.address)).to.be.revertedWith('44');
    });
    it('success - on top of an existing borrow', async () => {
      // Collat amount in stable should be 4
      // So max borrowable amount is 2
      const collatAmount = parseUnits('2', collatBase);
      const borrowAmount = parseEther('0.999');
      await collateral.connect(alice).mint(alice.address, collatAmount);
      await collateral.connect(alice).approve(vaultManager.address, collatAmount);
      await angle(vaultManager, alice, [
        createVault(alice.address),
        createVault(alice.address),
        addCollateral(2, collatAmount),
        borrow(2, borrowAmount),
      ]);
      await angle(vaultManager, alice, [borrow(2, parseEther('1'))]);

      expectApprox(await vaultManager.getVaultDebt(2), parseEther('1.9989'), 0.1);
      expectApprox(await vaultManager.surplus(), parseEther('0.19989'), 0.01);
      await expect(vaultManager.checkLiquidation(2, alice.address)).to.be.revertedWith('44');
    });
  });

  describe('repayDebt', () => {
    it('success - debt repaid', async () => {
      const collatAmount = parseUnits('2', collatBase);
      const borrowAmount = parseEther('1.999');
      await collateral.connect(alice).mint(alice.address, collatAmount);
      await collateral.connect(alice).approve(vaultManager.address, collatAmount);
      await angle(vaultManager, alice, [
        createVault(alice.address),
        createVault(alice.address),
        addCollateral(2, collatAmount),
        borrow(2, borrowAmount),
      ]);
      await angle(vaultManager, alice, [repayDebt(2, parseEther('1'))]);
      expectApprox(await vaultManager.getVaultDebt(2), parseEther('0.9989'), 0.1);
    });
    it('success - when amount to repay is slightly above the debt and rounded down', async () => {
      const collatAmount = parseUnits('2', collatBase);
      const borrowAmount = parseEther('1.999');
      await collateral.connect(alice).mint(alice.address, collatAmount);
      await collateral.connect(alice).approve(vaultManager.address, collatAmount);
      await stableMaster.connect(alice).mint(agToken.address, alice.address, borrowAmount);
      await agToken.connect(alice).approve(vaultManager.address, borrowAmount);
      await angle(vaultManager, alice, [
        createVault(alice.address),
        createVault(alice.address),
        addCollateral(2, collatAmount),
        borrow(2, borrowAmount),
        repayDebt(2, borrowAmount.add(1)),
      ]);
      expect(await vaultManager.getVaultDebt(2)).to.be.equal(0);
    });

    it('success - in just one transaction', async () => {
      const collatAmount = parseUnits('2', collatBase);
      const borrowAmount = parseEther('1.999');
      await collateral.connect(alice).mint(alice.address, collatAmount);
      await collateral.connect(alice).approve(vaultManager.address, collatAmount);
      await angle(vaultManager, alice, [
        createVault(alice.address),
        createVault(alice.address),
        addCollateral(2, collatAmount),
        borrow(2, borrowAmount),
        repayDebt(2, parseEther('1')),
      ]);
      expectApprox(await vaultManager.getVaultDebt(2), parseEther('0.9989'), 0.1);
    });
    it('reverts - debt repaid but dusty amount left', async () => {
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
        borrow(1, borrowAmount),
      ]);
      const vaultDebt = await vaultManager.getVaultDebt(2);
      await expect(angle(vaultManager, alice, [repayDebt(2, vaultDebt.add(parseUnits('3', 9)))])).to.be.revertedWith(
        '24',
      );
    });
  });
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
      await angle(vaultManager, alice, [getDebtIn(1, vaultManager.address, 2, parseEther('1'))]);
      expectApprox(await vaultManager.getVaultDebt(2), parseEther('1'), 0.1);
      expectApprox(await vaultManager.getVaultDebt(1), parseEther('1'), 0.1);
    });
    it('reverts - invalid vaultManager', async () => {
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
      await expect(angle(vaultManager, alice, [getDebtIn(1, alice.address, 2, parseEther('1'))])).to.be.revertedWith(
        '22',
      );
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
        new VaultManager__factory(deployer),
        0.1e9,
        0.1e9,
      )) as VaultManager;
      await vaultManager2.initialize(treasury.address, collateral.address, oracle.address, params, 'USDC - 2/agEUR');
      await vaultManager2.connect(guardian).togglePause();
      await treasury.setVaultManager2(vaultManager2.address);
      await treasury.addMinter(agToken.address, vaultManager2.address);
      await collateral.connect(alice).approve(vaultManager2.address, collatAmount.mul(10));
      await angle(vaultManager2, alice, [
        createVault(alice.address),
        addCollateral(1, collatAmount),
        borrow(1, borrowAmount),
      ]);
      const surplusPre = await vaultManager.surplus();
      expectApprox(await vaultManager2.getVaultDebt(1), parseEther('1.9989'), 0.1);
      await angle(vaultManager, alice, [getDebtIn(1, vaultManager2.address, 1, parseEther('1'))]);
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
        new VaultManager__factory(deployer),
        0.1e9,
        0.1e9,
      )) as VaultManager;

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
      const surplusPre = await vaultManager2.surplus();
      expectApprox(await vaultManager2.getVaultDebt(1), parseEther('1.999'), 0.1);
      await angle(vaultManager, alice, [getDebtIn(1, vaultManager2.address, 1, parseEther('1'))]);
      expectApprox(await vaultManager2.getVaultDebt(1), parseEther('1.1'), 0.1);
      expectApprox(await vaultManager.getVaultDebt(1), parseEther('1'), 0.1);
      expectApprox(await vaultManager2.surplus(), surplusPre.add(parseEther('0.1')), 0.1);
    });
  });

  describe('getDebtOut', () => {
    it('reverts - invalid sender', async () => {
      await expect(vaultManager.getDebtOut(1, 0, 0)).to.be.revertedWith('3');
    });
  });
  describe('permit', () => {
    beforeEach(async () => {
      // Need to have agToken as a collateral here
      stableMaster = await new MockStableMaster__factory(deployer).deploy();
      agToken = (await deployUpgradeable(new AgToken__factory(deployer))) as AgToken;
      await agToken.connect(deployer).initialize('agEUR', 'agEUR', stableMaster.address);
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
      oracle = await new MockOracle__factory(deployer).deploy(parseUnits('2', 18), collatBase, treasury.address);
      await vaultManager.initialize(treasury.address, agToken.address, oracle.address, params, 'USDC/agEUR');
      await vaultManager.connect(guardian).togglePause();
    });
    it('success - allowance given', async () => {
      const permitData = await signPermit(
        bob,
        0,
        agToken.address,
        (await latestTime()) + 1000,
        vaultManager.address,
        parseEther('1'),
        'agEUR',
      );
      await angle(vaultManager, bob, [permit(permitData)]);
      expect(await agToken.allowance(bob.address, vaultManager.address)).to.be.equal(parseEther('1'));
    });
    it('reverts - overflow on v', async () => {
      const permitData = await signPermit(
        bob,
        0,
        agToken.address,
        (await latestTime()) + 1000,
        vaultManager.address,
        parseEther('1'),
        'agEUR',
      );
      // Max value for a uint8 is 255
      permitData.v = 10000000;
      await expect(angle(vaultManager, bob, [permit(permitData)])).to.be.reverted;
    });
    it('reverts - invalid signature', async () => {
      const permitData = await signPermit(
        bob,
        0,
        agToken.address,
        (await latestTime()) + 1000,
        vaultManager.address,
        parseEther('1'),
        'test',
      );
      await expect(angle(vaultManager, bob, [permit(permitData)])).to.be.reverted;
    });
  });
  describe('composed actions', () => {
    const collatAmount = parseUnits('2', collatBase);
    const borrowAmount = parseEther('1.999');
    const adjustedBorrowAmount = borrowAmount.mul(BigNumber.from(90)).div(BigNumber.from(100));
    beforeEach(async () => {
      await collateral.connect(alice).mint(alice.address, collatAmount.mul(10));
      await collateral.connect(alice).approve(vaultManager.address, collatAmount.mul(10));
      mockRepayCallee = (await new MockRepayCallee__factory(deployer).deploy()) as MockRepayCallee;
      await stableMaster.connect(bob).mint(agToken.address, bob.address, borrowAmount.mul(1000));
      await angle(vaultManager, alice, [
        createVault(alice.address),
        createVault(alice.address),
        addCollateral(2, collatAmount.mul(2)),
        borrow(2, borrowAmount),
      ]);
    });
    it('success - stablecoin and collateral to receive by the protocol', async () => {
      expect((await vaultManager.vaultData(2)).collateralAmount).to.be.equal(collatAmount.mul(2));
      expectApprox(await vaultManager.getVaultDebt(2), parseEther('1.9989'), 0.1);
      await angle(vaultManager, alice, [addCollateral(2, collatAmount), repayDebt(2, parseEther('1'))]);
      expect((await vaultManager.vaultData(2)).collateralAmount).to.be.equal(collatAmount.mul(3));
      expectApprox(await vaultManager.getVaultDebt(2), parseEther('0.9989'), 0.1);
    });
    it('success - stablecoin and collateral to receive by the protocol with a different from address', async () => {
      await agToken.connect(bob).approve(alice.address, parseEther('10'));
      const bobStablecoinBalance = await agToken.balanceOf(bob.address);
      const bobCollateralBalance = await collateral.balanceOf(bob.address);
      const aliceStablecoinBalance = await agToken.balanceOf(alice.address);
      const aliceCollateralBalance = await collateral.balanceOf(alice.address);
      await angle(
        vaultManager,
        alice,
        [addCollateral(2, collatAmount), repayDebt(2, parseEther('1'))],
        bob.address,
        alice.address,
        ZERO_ADDRESS,
        web3.utils.keccak256('test'),
      );
      expect((await vaultManager.vaultData(2)).collateralAmount).to.be.equal(collatAmount.mul(3));
      expectApprox(await vaultManager.getVaultDebt(2), parseEther('0.9989'), 0.1);
      expect(await agToken.balanceOf(bob.address)).to.be.equal(bobStablecoinBalance.sub(parseEther('1')));
      expect(await collateral.balanceOf(bob.address)).to.be.equal(bobCollateralBalance);
      expect(await agToken.balanceOf(alice.address)).to.be.equal(aliceStablecoinBalance);
      expect(await collateral.balanceOf(alice.address)).to.be.equal(aliceCollateralBalance.sub(collatAmount));
    });
    it('reverts - stablecoin and collateral to receive by the protocol but from address has not approved', async () => {
      await expect(
        angle(
          vaultManager,
          alice,
          [addCollateral(2, collatAmount), repayDebt(2, parseEther('1'))],
          bob.address,
          alice.address,
          ZERO_ADDRESS,
          web3.utils.keccak256('test'),
        ),
      ).to.be.revertedWith('23');
    });
    it('success - stablecoin and collateral to be paid by the protocol', async () => {
      await angle(vaultManager, alice, [createVault(alice.address), addCollateral(3, collatAmount.mul(2))]);
      expect((await vaultManager.vaultData(3)).collateralAmount).to.be.equal(collatAmount.mul(2));
      const aliceStablecoinBalance = await agToken.balanceOf(alice.address);
      const aliceCollateralBalance = await collateral.balanceOf(alice.address);
      await angle(vaultManager, alice, [removeCollateral(3, collatAmount), borrow(3, borrowAmount)]);
      expectApprox(await vaultManager.getVaultDebt(3), parseEther('1.9989'), 0.1);
      expect((await vaultManager.vaultData(3)).collateralAmount).to.be.equal(collatAmount);
      expectApprox(await agToken.balanceOf(alice.address), aliceStablecoinBalance.add(adjustedBorrowAmount), 0.01);
      expect(await collateral.balanceOf(alice.address)).to.be.equal(aliceCollateralBalance.add(collatAmount));
    });
    it('success - stablecoin and collateral to be paid by the protocol with a different to address', async () => {
      await angle(vaultManager, alice, [createVault(alice.address), addCollateral(3, collatAmount.mul(2))]);
      expect((await vaultManager.vaultData(3)).collateralAmount).to.be.equal(collatAmount.mul(2));
      const aliceStablecoinBalance = await agToken.balanceOf(alice.address);
      const aliceCollateralBalance = await collateral.balanceOf(alice.address);
      const bobStablecoinBalance = await agToken.balanceOf(bob.address);
      const bobCollateralBalance = await collateral.balanceOf(bob.address);
      await angle(
        vaultManager,
        alice,
        [removeCollateral(3, collatAmount), borrow(3, borrowAmount)],
        alice.address,
        bob.address,
        ZERO_ADDRESS,
        web3.utils.keccak256('test'),
      );
      expectApprox(await vaultManager.getVaultDebt(3), parseEther('1.9989'), 0.1);
      expect((await vaultManager.vaultData(3)).collateralAmount).to.be.equal(collatAmount);
      expect(await collateral.balanceOf(alice.address)).to.be.equal(aliceCollateralBalance);
      expect(await agToken.balanceOf(alice.address)).to.be.equal(aliceStablecoinBalance);
      expect(await collateral.balanceOf(bob.address)).to.be.equal(bobCollateralBalance.add(collatAmount));
      expectApprox(await agToken.balanceOf(bob.address), bobStablecoinBalance.add(borrowAmount), 0.1);
    });
    it('success - handle repay with repay callee', async () => {
      const aliceStablecoinBalance = await agToken.balanceOf(alice.address);
      const aliceCollateralBalance = await collateral.balanceOf(alice.address);
      await angle(
        vaultManager,
        alice,
        [repayDebt(2, parseEther('1')), removeCollateral(2, collatAmount)],
        alice.address,
        alice.address,
        mockRepayCallee.address,
        web3.utils.keccak256('test'),
      );
      expect((await vaultManager.vaultData(2)).collateralAmount).to.be.equal(collatAmount);
      expectApprox(await vaultManager.getVaultDebt(2), parseEther('0.9989'), 0.1);
      expect(await mockRepayCallee.counter()).to.be.equal(1);
      expect(await agToken.balanceOf(alice.address)).to.be.equal(aliceStablecoinBalance.sub(parseEther('1')));
      expect(await collateral.balanceOf(alice.address)).to.be.equal(aliceCollateralBalance.add(collatAmount));
    });
    it('success - handle repay with repay callee and null stablecoin amount to repay', async () => {
      const aliceStablecoinBalance = await agToken.balanceOf(alice.address);
      const aliceCollateralBalance = await collateral.balanceOf(alice.address);
      await angle(
        vaultManager,
        alice,
        [removeCollateral(2, collatAmount)],
        alice.address,
        alice.address,
        mockRepayCallee.address,
        web3.utils.keccak256('test'),
      );
      expect((await vaultManager.vaultData(2)).collateralAmount).to.be.equal(collatAmount);
      expectApprox(await vaultManager.getVaultDebt(2), parseEther('1.9989'), 0.1);
      expect(await mockRepayCallee.counter()).to.be.equal(0);
      expect(await agToken.balanceOf(alice.address)).to.be.equal(aliceStablecoinBalance);
      expect(await collateral.balanceOf(alice.address)).to.be.equal(aliceCollateralBalance.add(collatAmount));
    });
    it('success - handle repay with repay callee, null stablecoin amount to repay and a different to address', async () => {
      const aliceStablecoinBalance = await agToken.balanceOf(alice.address);
      const aliceCollateralBalance = await collateral.balanceOf(alice.address);
      const bobStablecoinBalance = await agToken.balanceOf(bob.address);
      const bobCollateralBalance = await collateral.balanceOf(bob.address);
      await angle(
        vaultManager,
        alice,
        [removeCollateral(2, collatAmount)],
        alice.address,
        bob.address,
        mockRepayCallee.address,
        web3.utils.keccak256('test'),
      );
      expect((await vaultManager.vaultData(2)).collateralAmount).to.be.equal(collatAmount);
      expectApprox(await vaultManager.getVaultDebt(2), parseEther('1.9989'), 0.1);
      expect(await mockRepayCallee.counter()).to.be.equal(0);
      expect(await collateral.balanceOf(bob.address)).to.be.equal(bobCollateralBalance.add(collatAmount));
      expect(await collateral.balanceOf(alice.address)).to.be.equal(aliceCollateralBalance);
      expect(await agToken.balanceOf(alice.address)).to.be.equal(aliceStablecoinBalance);
      expect(await agToken.balanceOf(bob.address)).to.be.equal(bobStablecoinBalance);
    });
    it('reverts - handle repay from address not approved', async () => {
      await expect(
        angle(
          vaultManager,
          alice,
          [repayDebt(2, parseEther('1')), removeCollateral(2, collatAmount)],
          bob.address,
          bob.address,
          mockRepayCallee.address,
          web3.utils.keccak256('test'),
        ),
      ).to.be.revertedWith('23');
    });
    it('reverts - handle repay when the who address is invalid', async () => {
      await expect(
        angle(
          vaultManager,
          alice,
          [repayDebt(2, parseEther('1')), removeCollateral(2, collatAmount)],
          bob.address,
          bob.address,
          ZERO_ADDRESS,
          web3.utils.keccak256('test'),
        ),
      ).to.be.reverted;
    });
    it('success - handle repay with an approved address', async () => {
      const aliceStablecoinBalance = await agToken.balanceOf(alice.address);
      const aliceCollateralBalance = await collateral.balanceOf(alice.address);
      const bobStablecoinBalance = await agToken.balanceOf(bob.address);
      const bobCollateralBalance = await collateral.balanceOf(bob.address);
      await agToken.connect(bob).approve(alice.address, parseEther('10'));
      await angle(
        vaultManager,
        alice,
        [repayDebt(2, parseEther('1')), removeCollateral(2, collatAmount)],
        bob.address,
        bob.address,
        mockRepayCallee.address,
        web3.utils.keccak256('test'),
      );
      expect((await vaultManager.vaultData(2)).collateralAmount).to.be.equal(collatAmount);
      expect(await mockRepayCallee.counter()).to.be.equal(1);
      expectApprox(await vaultManager.getVaultDebt(2), parseEther('0.9989'), 0.1);
      expect(await collateral.balanceOf(bob.address)).to.be.equal(bobCollateralBalance.add(collatAmount));
      expect(await collateral.balanceOf(alice.address)).to.be.equal(aliceCollateralBalance);
      expect(await agToken.balanceOf(alice.address)).to.be.equal(aliceStablecoinBalance);
      expectApprox(await agToken.balanceOf(bob.address), bobStablecoinBalance.sub(borrowAmount), 0.1);
    });
    it('reverts - handle repay with an approved address but fails to get enough stablecoins', async () => {
      await agToken.connect(charlie).approve(alice.address, parseEther('10'));
      await expect(
        angle(
          vaultManager,
          alice,
          [repayDebt(2, parseEther('1')), removeCollateral(2, collatAmount)],
          charlie.address,
          bob.address,
          mockRepayCallee.address,
          web3.utils.keccak256('test'),
        ),
      ).to.be.reverted;
    });
    it('success - handle repay with an approved address but no who contract', async () => {
      const aliceStablecoinBalance = await agToken.balanceOf(alice.address);
      const aliceCollateralBalance = await collateral.balanceOf(alice.address);
      const bobStablecoinBalance = await agToken.balanceOf(bob.address);
      const bobCollateralBalance = await collateral.balanceOf(bob.address);
      await agToken.connect(bob).approve(alice.address, parseEther('10'));
      await angle(
        vaultManager,
        alice,
        [repayDebt(2, parseEther('1')), removeCollateral(2, collatAmount)],
        bob.address,
        bob.address,
        ZERO_ADDRESS,
        '0x',
      );
      expect((await vaultManager.vaultData(2)).collateralAmount).to.be.equal(collatAmount);
      expect(await mockRepayCallee.counter()).to.be.equal(0);
      expectApprox(await vaultManager.getVaultDebt(2), parseEther('0.9989'), 0.1);
      expect(await collateral.balanceOf(bob.address)).to.be.equal(bobCollateralBalance.add(collatAmount));
      expect(await collateral.balanceOf(alice.address)).to.be.equal(aliceCollateralBalance);
      expect(await agToken.balanceOf(alice.address)).to.be.equal(aliceStablecoinBalance);
      expectApprox(await agToken.balanceOf(bob.address), bobStablecoinBalance.sub(parseEther('1')), 0.1);
    });
    it('success - repayCallCollateral with the same from and to address', async () => {
      const aliceStablecoinBalance = await agToken.balanceOf(alice.address);
      const aliceCollateralBalance = await collateral.balanceOf(alice.address);
      await angle(
        vaultManager,
        alice,
        [addCollateral(2, collatAmount), borrow(2, borrowAmount)],
        alice.address,
        alice.address,
        mockRepayCallee.address,
        web3.utils.keccak256('test'),
      );
      expect((await vaultManager.vaultData(2)).collateralAmount).to.be.equal(collatAmount.mul(3));
      expectApprox(await vaultManager.getVaultDebt(2), parseEther('3.9989'), 0.1);
      expect(await mockRepayCallee.counter()).to.be.equal(1);
      expect(await collateral.balanceOf(alice.address)).to.be.equal(aliceCollateralBalance.sub(collatAmount));
      expectApprox(await agToken.balanceOf(alice.address), aliceStablecoinBalance.add(adjustedBorrowAmount), 0.1);
    });
    it('success - repayCallCollateral different from address has no impact', async () => {
      const aliceStablecoinBalance = await agToken.balanceOf(alice.address);
      const aliceCollateralBalance = await collateral.balanceOf(alice.address);
      const bobStablecoinBalance = await agToken.balanceOf(bob.address);
      const bobCollateralBalance = await collateral.balanceOf(bob.address);
      await angle(
        vaultManager,
        alice,
        [addCollateral(2, collatAmount), borrow(2, borrowAmount)],
        bob.address,
        alice.address,
        mockRepayCallee.address,
        web3.utils.keccak256('test'),
      );
      expect((await vaultManager.vaultData(2)).collateralAmount).to.be.equal(collatAmount.mul(3));
      expectApprox(await vaultManager.getVaultDebt(2), parseEther('3.9989'), 0.1);
      expect(await mockRepayCallee.counter()).to.be.equal(1);
      expect(await collateral.balanceOf(alice.address)).to.be.equal(aliceCollateralBalance.sub(collatAmount));
      expectApprox(await agToken.balanceOf(alice.address), aliceStablecoinBalance.add(adjustedBorrowAmount), 0.1);
      expect(await collateral.balanceOf(bob.address)).to.be.equal(bobCollateralBalance);
      expect(await agToken.balanceOf(bob.address)).to.be.equal(bobStablecoinBalance);
    });
    it('reverts - repayCallCollateral repayCallee fails to put the correct balance', async () => {
      const aliceCollateralBalance = await collateral.balanceOf(alice.address);
      await collateral.connect(alice).transfer(bob.address, aliceCollateralBalance);
      await expect(
        angle(
          vaultManager,
          alice,
          [addCollateral(2, collatAmount), borrow(2, borrowAmount)],
          bob.address,
          charlie.address,
          mockRepayCallee.address,
          web3.utils.keccak256('test'),
        ),
      ).to.be.reverted;
    });
    it('success - repayCallCollateral different from address and to address', async () => {
      const aliceStablecoinBalance = await agToken.balanceOf(alice.address);
      const aliceCollateralBalance = await collateral.balanceOf(alice.address);
      const bobStablecoinBalance = await agToken.balanceOf(bob.address);
      const bobCollateralBalance = await collateral.balanceOf(bob.address);
      await angle(
        vaultManager,
        alice,
        [addCollateral(2, collatAmount), borrow(2, borrowAmount)],
        bob.address,
        charlie.address,
        mockRepayCallee.address,
        web3.utils.keccak256('test'),
      );
      expect((await vaultManager.vaultData(2)).collateralAmount).to.be.equal(collatAmount.mul(3));
      expectApprox(await vaultManager.getVaultDebt(2), parseEther('3.9989'), 0.1);
      expect(await mockRepayCallee.counter()).to.be.equal(1);
      expect(await collateral.balanceOf(alice.address)).to.be.equal(aliceCollateralBalance.sub(collatAmount));
      expect(await agToken.balanceOf(alice.address)).to.be.equal(aliceStablecoinBalance);
      expect(await collateral.balanceOf(bob.address)).to.be.equal(bobCollateralBalance);
      expect(await agToken.balanceOf(bob.address)).to.be.equal(bobStablecoinBalance);
      expectApprox(await agToken.balanceOf(charlie.address), adjustedBorrowAmount, 0.1);
    });
    it('reverts - repayCallCollateral who address is invalid', async () => {
      await expect(
        angle(
          vaultManager,
          alice,
          [addCollateral(2, collatAmount), borrow(2, borrowAmount)],
          alice.address,
          alice.address,
          alice.address,
          web3.utils.keccak256('test'),
        ),
      ).to.be.reverted;
    });
    it('success - repayCallCollateral situation with no repay callee', async () => {
      const aliceStablecoinBalance = await agToken.balanceOf(alice.address);
      const aliceCollateralBalance = await collateral.balanceOf(alice.address);
      await angle(
        vaultManager,
        alice,
        [addCollateral(2, collatAmount), borrow(2, borrowAmount)],
        alice.address,
        alice.address,
        mockRepayCallee.address,
        '0x',
      );
      expect((await vaultManager.vaultData(2)).collateralAmount).to.be.equal(collatAmount.mul(3));
      expectApprox(await vaultManager.getVaultDebt(2), parseEther('3.9989'), 0.1);
      expect(await mockRepayCallee.counter()).to.be.equal(0);
      expect(await collateral.balanceOf(alice.address)).to.be.equal(aliceCollateralBalance.sub(collatAmount));
      expectApprox(await agToken.balanceOf(alice.address), aliceStablecoinBalance.add(adjustedBorrowAmount), 0.1);
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
      await vaultManager.connect(governor).setUint64(0.5e9, formatBytes32String('maxLiquidationDiscount'));
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
      ).to.be.revertedWith('25');
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
    });
  });
  describe('getTotalDebt', () => {
    const collatAmount = parseUnits('2', collatBase);
    const borrowAmount = parseEther('1');

    beforeEach(async () => {
      // Collat amount in stable should be 4
      // So max borrowable amount is 2
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
      await vaultManager.connect(governor).setUint64(0, formatBytes32String('interestRate'));

      await increaseTime(1000);

      expectApprox(await vaultManager.getTotalDebt(), debt, 0.001);
    });
  });
  describe('liquidation with dust', () => {
    const collatAmount = parseUnits('2', collatBase);
    const borrowAmount = parseEther('1');
    beforeEach(async () => {
      vaultManager = (await deployUpgradeable(
        new VaultManager__factory(deployer),
        parseEther('0.5'),
        parseEther('0.5'),
      )) as VaultManager;

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
        new VaultManager__factory(deployer),
        parseEther('0.5'),
        parseEther('0.5'),
      )) as VaultManager;

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
    });
  });
  describe('accrueInterestToTreasury', () => {
    it('reverts - non treasury', async () => {
      await expect(vaultManager.accrueInterestToTreasury()).to.be.revertedWith('14');
    });
    it('success - when nothing in it', async () => {
      params.interestRate = parseUnits(ratePerSecond.toFixed(27), 27);
      expect(await vaultManager.interestAccumulator()).to.be.equal(parseUnits('1', 27));
      expect(await vaultManager.surplus()).to.be.equal(0);
      const receipt = await (await treasury.accrueInterestToTreasuryVaultManager(vaultManager.address)).wait();
      expect(await vaultManager.interestAccumulator()).to.be.equal(parseUnits('1', 27));
      inIndirectReceipt(
        receipt,
        new utils.Interface(['event AccruedToTreasury(uint256 surplusEndValue, uint256 badDebtEndValue)']),
        'AccruedToTreasury',
        {
          badDebtEndValue: 0,
          surplusEndValue: 0,
        },
      );
      inIndirectReceipt(
        receipt,
        new utils.Interface(['event InterestRateAccumulatorUpdated(uint256 value, uint256 timestamp)']),
        'InterestRateAccumulatorUpdated',
        {
          value: parseUnits('1', 27),
          timestamp: await latestTime(),
        },
      );
      expect(await vaultManager.surplus()).to.be.equal(0);
      expect(await vaultManager.badDebt()).to.be.equal(0);
    });
    it('success - when surplus in it', async () => {
      // First borrowing collateral
      const collatAmount = parseUnits('2', collatBase);
      const borrowAmount = parseEther('0.999');
      await collateral.connect(alice).mint(alice.address, collatAmount);
      await collateral.connect(alice).approve(vaultManager.address, collatAmount);
      await angle(vaultManager, alice, [
        createVault(alice.address),
        createVault(alice.address),
        addCollateral(2, collatAmount),
        borrow(2, borrowAmount),
      ]);
      const receipt = await (await treasury.accrueInterestToTreasuryVaultManager(vaultManager.address)).wait();
      inIndirectReceipt(
        receipt,
        new utils.Interface(['event AccruedToTreasury(uint256 surplusEndValue, uint256 badDebtEndValue)']),
        'AccruedToTreasury',
        {
          badDebtEndValue: 0,
        },
      );
      inIndirectReceipt(
        receipt,
        new utils.Interface(['event InterestRateAccumulatorUpdated(uint256 value, uint256 timestamp)']),
        'InterestRateAccumulatorUpdated',
        {
          timestamp: await latestTime(),
        },
      );
      expect(await vaultManager.surplus()).to.be.equal(0);
      expect(await vaultManager.badDebt()).to.be.equal(0);
    });
    it('success - when bad debt', async () => {
      // Creating the bad debt from a liquidation
      const collatAmount = parseUnits('2', collatBase);
      const borrowAmount = parseEther('0.999');
      await collateral.connect(alice).mint(alice.address, collatAmount);
      await collateral.connect(alice).approve(vaultManager.address, collatAmount);
      await angle(vaultManager, alice, [
        createVault(alice.address),
        createVault(alice.address),
        addCollateral(2, collatAmount),
        borrow(2, borrowAmount),
      ]);
      await stableMaster.connect(bob).mint(agToken.address, bob.address, borrowAmount.mul(100));
      await agToken.connect(bob).approve(vaultManager.address, borrowAmount.mul(100));
      const rate = 0.01;
      await oracle.update(parseEther(rate.toString()));
      await vaultManager
        .connect(bob)
        ['liquidate(uint256[],uint256[],address,address)'](
          [2],
          [(await vaultManager.checkLiquidation(2, bob.address)).maxStablecoinAmountToRepay],
          bob.address,
          bob.address,
        );
      const receipt = await (await treasury.accrueInterestToTreasuryVaultManager(vaultManager.address)).wait();
      inIndirectReceipt(
        receipt,
        new utils.Interface(['event AccruedToTreasury(uint256 surplusEndValue, uint256 badDebtEndValue)']),
        'AccruedToTreasury',
        {
          surplusEndValue: 0,
        },
      );
      inIndirectReceipt(
        receipt,
        new utils.Interface(['event InterestRateAccumulatorUpdated(uint256 value, uint256 timestamp)']),
        'InterestRateAccumulatorUpdated',
        {
          timestamp: await latestTime(),
        },
      );
      expect(await vaultManager.surplus()).to.be.equal(0);
      expect(await vaultManager.badDebt()).to.be.equal(0);
    });
  });
});
