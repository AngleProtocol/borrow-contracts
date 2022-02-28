import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { Signer } from 'ethers';
import { formatBytes32String, parseEther, parseUnits } from 'ethers/lib/utils';
import hre, { contract, ethers } from 'hardhat';

import {
  AgToken,
  AgToken__factory,
  MockOracle,
  MockOracle__factory,
  MockStableMaster,
  MockStableMaster__factory,
  MockToken,
  MockToken__factory,
  MockTreasury,
  MockTreasury__factory,
  VaultManager,
  VaultManager__factory,
} from '../../typechain';
import { expect } from '../utils/chai-setup';
import { deployUpgradeable, latestTime, ZERO_ADDRESS } from '../utils/helpers';

contract('VaultManager - Setters', () => {
  let deployer: SignerWithAddress;
  let governor: SignerWithAddress;
  let guardian: SignerWithAddress;
  let alice: SignerWithAddress;

  let treasury: MockTreasury;
  let collateral: MockToken;
  let oracle: MockOracle;
  let stableMaster: MockStableMaster;
  let agToken: AgToken;
  let vaultManager: VaultManager;

  const impersonatedSigners: { [key: string]: Signer } = {};

  const collatBase = 10;
  const params = {
    debtCeiling: parseEther('100'),
    collateralFactor: 0.5e9,
    targetHealthFactor: 1.1e9,
    borrowFee: 0.1e9,
    interestRate: 100,
    liquidationSurcharge: 0.9e9,
    maxLiquidationDiscount: 0.1e9,
    liquidationBooster: 0.1e9,
    whitelistingActivated: false,
    baseBoost: 1e9,
  };

  before(async () => {
    ({ deployer, alice, governor, guardian } = await ethers.getNamedSigners());
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
    await vaultManager.initialize(treasury.address, collateral.address, oracle.address, params);
    await vaultManager.connect(guardian).togglePause();
  });

  describe('setUint64', () => {
    it('reverts - access control', async () => {
      await expect(
        vaultManager.connect(alice).setUint64(params.liquidationSurcharge, formatBytes32String('collateralFactor')),
      ).to.be.revertedWith('2');
    });
    it('success - guardian', async () => {
      await vaultManager
        .connect(guardian)
        .setUint64(params.liquidationSurcharge, formatBytes32String('collateralFactor'));
      expect(await vaultManager.collateralFactor()).to.be.equal(params.liquidationSurcharge);
    });
    it('success - governor', async () => {
      await vaultManager
        .connect(governor)
        .setUint64(params.liquidationSurcharge, formatBytes32String('collateralFactor'));
      expect(await vaultManager.collateralFactor()).to.be.equal(params.liquidationSurcharge);
    });
    it('success - collateralFactor', async () => {
      await vaultManager
        .connect(governor)
        .setUint64(params.liquidationSurcharge, formatBytes32String('collateralFactor'));
      expect(await vaultManager.collateralFactor()).to.be.equal(params.liquidationSurcharge);
    });
    it('reverts - collateralFactor too high', async () => {
      await expect(
        vaultManager
          .connect(governor)
          .setUint64(params.liquidationSurcharge + 1, formatBytes32String('collateralFactor')),
      ).to.be.revertedWith('9');
    });
    it('success - targetHealthFactor', async () => {
      await vaultManager.connect(governor).setUint64(1e9 + 1, formatBytes32String('targetHealthFactor'));
      expect(await vaultManager.targetHealthFactor()).to.be.equal(1e9 + 1);
    });
    it('reverts - targetHealthFactor too low', async () => {
      await expect(
        vaultManager.connect(governor).setUint64(1e9 - 1, formatBytes32String('targetHealthFactor')),
      ).to.be.revertedWith('17');
    });
    it('success - borrowFee', async () => {
      await vaultManager.connect(governor).setUint64(1e9 - 1, formatBytes32String('borrowFee'));
      expect(await vaultManager.borrowFee()).to.be.equal(1e9 - 1);
    });
    it('reverts - borrowFee too high', async () => {
      await expect(
        vaultManager.connect(governor).setUint64(1e9 + 1, formatBytes32String('borrowFee')),
      ).to.be.revertedWith('9');
    });
    it('success - interestRate', async () => {
      const timestamp = await latestTime();
      await vaultManager.connect(governor).setUint64(1e9 - 1, formatBytes32String('interestRate'));
      expect(await vaultManager.interestRate()).to.be.equal(1e9 - 1);
      expect(await vaultManager.lastInterestAccumulatorUpdated()).to.be.gt(timestamp);
    });
    it('success - liquidationSurcharge', async () => {
      await vaultManager.connect(governor).setUint64(1e9 - 1, formatBytes32String('liquidationSurcharge'));
      expect(await vaultManager.liquidationSurcharge()).to.be.equal(1e9 - 1);
    });
    it('reverts - liquidationSurcharge too high', async () => {
      await expect(
        vaultManager.connect(governor).setUint64(1e9 + 1, formatBytes32String('liquidationSurcharge')),
      ).to.be.revertedWith('18');
    });
    it('reverts - liquidationSurcharge too low', async () => {
      await expect(
        vaultManager
          .connect(governor)
          .setUint64(params.collateralFactor - 1, formatBytes32String('liquidationSurcharge')),
      ).to.be.revertedWith('18');
    });
    it('success - maxLiquidationDiscount', async () => {
      await vaultManager.connect(governor).setUint64(1e9 - 1, formatBytes32String('maxLiquidationDiscount'));
      expect(await vaultManager.maxLiquidationDiscount()).to.be.equal(1e9 - 1);
    });
    it('reverts - maxLiquidationDiscount too high', async () => {
      await expect(
        vaultManager.connect(governor).setUint64(1e9 + 1, formatBytes32String('maxLiquidationDiscount')),
      ).to.be.revertedWith('9');
    });
    it('reverts - wrong parameter', async () => {
      await expect(
        vaultManager.connect(governor).setUint64(params.liquidationSurcharge, formatBytes32String('example')),
      ).to.be.revertedWith('43');
    });
  });

  describe('setDebtCeiling', () => {
    it('reverts - access control', async () => {
      await expect(vaultManager.connect(alice).setDebtCeiling(127)).to.be.revertedWith('2');
    });
    it('success - guardian', async () => {
      await vaultManager.connect(guardian).setDebtCeiling(127);
      expect(await vaultManager.debtCeiling()).to.be.equal(127);
    });
    it('success - governor', async () => {
      await vaultManager.connect(governor).setDebtCeiling(127);
      expect(await vaultManager.debtCeiling()).to.be.equal(127);
    });
    it('success - debtCeiling', async () => {
      await vaultManager.connect(governor).setDebtCeiling(127);
      expect(await vaultManager.debtCeiling()).to.be.equal(127);
    });
  });

  describe('setOracle', () => {
    beforeEach(async () => {
      oracle = await new MockOracle__factory(deployer).deploy(parseUnits('2', 18), 1, treasury.address);
    });
    it('reverts - access control', async () => {
      await expect(vaultManager.connect(alice).setOracle(oracle.address)).to.be.revertedWith('1');
    });
    it('reverts - guardian', async () => {
      await expect(vaultManager.connect(guardian).setOracle(oracle.address)).to.be.revertedWith('1');
    });
    it('reverts - wrong treasury', async () => {
      oracle = await new MockOracle__factory(deployer).deploy(parseUnits('2', 18), 1, agToken.address);
      await expect(vaultManager.connect(governor).setOracle(oracle.address)).to.be.revertedWith('33');
    });
    it('success - governor', async () => {
      await vaultManager.connect(governor).setOracle(oracle.address);
      expect(await vaultManager.oracle()).to.be.equal(oracle.address);
    });
  });

  describe('setTreasury', () => {
    beforeEach(async () => {
      await vaultManager.connect(governor).toggleWhitelisting();
    });
    it('reverts - access control', async () => {
      await expect(vaultManager.connect(alice).setTreasury(agToken.address)).to.be.revertedWith('14');
    });
    it('reverts - guardian', async () => {
      await expect(vaultManager.connect(guardian).setTreasury(agToken.address)).to.be.revertedWith('14');
    });

    it('success - treasury', async () => {
      await treasury.connect(governor).setTreasury(vaultManager.address, agToken.address);
      expect(await vaultManager.treasury()).to.be.equal(agToken.address);
      expect(await oracle.treasury()).to.be.equal(agToken.address);
    });
  });

  describe('toggleWhitelist', () => {
    it('reverts - access control', async () => {
      await expect(vaultManager.connect(alice).toggleWhitelist(alice.address)).to.be.revertedWith('1');
    });
    it('reverts - guardian', async () => {
      await expect(vaultManager.connect(guardian).toggleWhitelist(alice.address)).to.be.revertedWith('1');
    });
    it('success - governor', async () => {
      await vaultManager.connect(governor).toggleWhitelist(alice.address);
      expect(await vaultManager.isWhitelisted(alice.address)).to.be.true;

      await vaultManager.connect(governor).toggleWhitelist(alice.address);
      expect(await vaultManager.isWhitelisted(alice.address)).to.be.false;
    });
  });

  describe('whenNotPaused', () => {
    it('success - paused', async () => {
      await vaultManager.connect(guardian).togglePause();
      expect(await vaultManager.paused()).to.be.true;
    });
  });

  describe('setLiquidationBoostParameters', () => {
    it('reverts - access control', async () => {
      await expect(
        vaultManager.connect(alice).setLiquidationBoostParameters(agToken.address, [22], [23]),
      ).to.be.revertedWith('2');
    });
    it('success - guardian', async () => {
      await vaultManager.connect(guardian).setLiquidationBoostParameters(agToken.address, [22, 23], [100, 101]);
    });
    it('success - governor', async () => {
      await vaultManager.connect(governor).setLiquidationBoostParameters(agToken.address, [22, 23], [100, 101]);
    });
    it('reverts - invalid entry', async () => {
      await expect(vaultManager.connect(governor).setLiquidationBoostParameters(ZERO_ADDRESS, [22], [])).to.be.reverted;
    });
    it('reverts - invalid entry', async () => {
      await expect(vaultManager.connect(governor).setLiquidationBoostParameters(agToken.address, [22], [23])).to.be
        .reverted;
    });
  });
});
