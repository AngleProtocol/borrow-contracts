import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { Signer } from 'ethers';
import { parseEther, parseUnits } from 'ethers/lib/utils';
import hre, { contract, ethers } from 'hardhat';

import {
  AgToken,
  AgToken__factory,
  BaseReactor,
  BaseReactor__factory,
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
import { deployUpgradeable, displayReactorState, expectApprox, ZERO_ADDRESS } from '../utils/helpers';

contract('Reactor', () => {
  const log = true;

  let deployer: SignerWithAddress;
  let governor: SignerWithAddress;
  let guardian: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  let reactor: BaseReactor;
  let treasury: MockTreasury;
  let angle: MockToken;
  let oracle: MockOracle;
  let stableMaster: MockStableMaster;
  let agEUR: AgToken;
  let vaultManager: VaultManager;

  const impersonatedSigners: { [key: string]: Signer } = {};

  const collatBase = 18;
  const yearlyRate = 1.05;
  const ratePerSecond = yearlyRate ** (1 / (365 * 24 * 3600)) - 1;
  const lowerCF = 0.2e9;
  const targetCF = 0.4e9;
  const upperCF = 0.6e9;

  const params = {
    debtCeiling: parseEther('100'),
    collateralFactor: 0.9e9,
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
    ({ deployer, alice, bob, governor, guardian } = await ethers.getNamedSigners());
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

    agEUR = (await deployUpgradeable(new AgToken__factory(deployer))) as AgToken;
    await agEUR.connect(deployer).initialize('agEUR', 'agEUR', stableMaster.address);

    angle = await new MockToken__factory(deployer).deploy('ANGLE', 'ANGLE', collatBase);

    vaultManager = (await deployUpgradeable(new VaultManager__factory(deployer), 0.1e9, 0.1e9)) as VaultManager;

    treasury = await new MockTreasury__factory(deployer).deploy(
      agEUR.address,
      governor.address,
      guardian.address,
      vaultManager.address,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
    );
    await agEUR.connect(impersonatedSigners.governor).setUpTreasury(treasury.address);
    await treasury.addMinter(agEUR.address, vaultManager.address);

    oracle = await new MockOracle__factory(deployer).deploy(parseUnits('2', 18), collatBase, treasury.address);

    reactor = (await deployUpgradeable(new BaseReactor__factory(deployer))) as BaseReactor;
    await reactor.initialize(
      'ANGLE/agEUR Mock Reactor',
      'ANGLE/agEUR Mock Reactor',
      angle.address,
      vaultManager.address,
      treasury.address,
      oracle.address,
      lowerCF,
      targetCF,
      upperCF,
      params,
    );

    await vaultManager.connect(guardian).togglePause();
  });

  describe('initialization', () => {
    it('success - state', async () => {
      expect(await reactor.lowerCF()).to.be.equal(lowerCF);
      expect(await reactor.targetCF()).to.be.equal(targetCF);
      expect(await reactor.upperCF()).to.be.equal(upperCF);
    });
  });

  describe('mint / deposit', () => {
    const sharesAmount = parseEther('1');
    beforeEach(async () => {
      await angle.connect(alice).mint(alice.address, sharesAmount);
      await angle.connect(alice).approve(reactor.address, sharesAmount);
      await reactor.connect(alice).mint(sharesAmount, alice.address);
    });

    it('success - added collateral to vault', async () => {
      await displayReactorState(reactor, log);
      expect(await angle.balanceOf(reactor.address)).to.be.equal(0);
      expect(await angle.balanceOf(vaultManager.address)).to.be.equal(sharesAmount);
      expectApprox(await vaultManager.getVaultDebt(1), sharesAmount.mul(2).mul(targetCF).div(1e9), 0.00001);
    });

    it('success - second mint with borrow', async () => {
      const secondSharesAmount = parseEther('1');
      await angle.connect(alice).mint(alice.address, secondSharesAmount);
      await angle.connect(alice).approve(reactor.address, secondSharesAmount);
      await reactor.connect(alice).mint(secondSharesAmount, alice.address);

      await displayReactorState(reactor, log);

      expect(await angle.balanceOf(reactor.address)).to.be.equal(0);
      expect(await angle.balanceOf(vaultManager.address)).to.be.equal(sharesAmount.add(secondSharesAmount));
      expectApprox(
        await vaultManager.getVaultDebt(1),
        sharesAmount.add(secondSharesAmount).mul(2).mul(targetCF).div(1e9),
        0.00001,
      );
    });

    it('success - second mint without borrow', async () => {
      const secondSharesAmount = parseEther('0.4');
      await angle.connect(alice).mint(alice.address, secondSharesAmount);
      await angle.connect(alice).approve(reactor.address, secondSharesAmount);
      await reactor.connect(alice).mint(secondSharesAmount, alice.address);

      await displayReactorState(reactor, log);

      expect(await angle.balanceOf(reactor.address)).to.be.equal(0);
      expect(await angle.balanceOf(vaultManager.address)).to.be.equal(sharesAmount.add(secondSharesAmount));
      expectApprox(await vaultManager.getVaultDebt(1), sharesAmount.mul(2).mul(targetCF).div(1e9), 0.00001);
    });

    it('success - second mint after gain', async () => {
      const gains = parseEther('1');
      await angle.mint(reactor.address, gains);

      const secondSharesAmount = parseEther('0.2');
      const secondAssetAmount = parseEther('0.4');
      await angle.connect(alice).mint(alice.address, secondAssetAmount);
      await angle.connect(alice).approve(reactor.address, secondAssetAmount);
      await reactor.connect(alice).mint(secondSharesAmount, alice.address);

      await displayReactorState(reactor, log);

      expect(await angle.balanceOf(reactor.address)).to.be.equal(0);
      expect(await angle.balanceOf(vaultManager.address)).to.be.equal(sharesAmount.add(secondAssetAmount).add(gains));
      expectApprox(
        await vaultManager.getVaultDebt(1),
        sharesAmount.add(secondAssetAmount).add(gains).mul(2).mul(targetCF).div(1e9),
        0.00001,
      );
    });
  });

  describe('deposit', () => {
    const assetsAmount = parseEther('1');
    beforeEach(async () => {
      await angle.connect(alice).mint(alice.address, assetsAmount);
      await angle.connect(alice).approve(reactor.address, assetsAmount);
      await reactor.connect(alice).deposit(assetsAmount, alice.address);
    });

    it('success - added collateral to vault', async () => {
      await displayReactorState(reactor, log);
      expect(await angle.balanceOf(reactor.address)).to.be.equal(0);
      expect(await angle.balanceOf(vaultManager.address)).to.be.equal(assetsAmount);
      expectApprox(await vaultManager.getVaultDebt(1), assetsAmount.mul(2).mul(targetCF).div(1e9), 0.00001);
    });
  });

  describe('withdraw / redeem', () => {
    const sharesAmount = parseEther('0.8');
    const assetsAmount = parseEther('1.6');

    const totalShares = parseEther('1');
    const totalAsset = parseEther('2');

    beforeEach(async () => {
      await angle.connect(alice).mint(alice.address, parseEther('1'));
      await angle.connect(alice).approve(reactor.address, parseEther('1'));
      await reactor.connect(alice).mint(parseEther('1'), alice.address);
      await angle.mint(reactor.address, parseEther('1'));
    });

    it('success - redeem', async () => {
      await displayReactorState(reactor, log);

      await reactor.connect(alice).redeem(sharesAmount, alice.address, alice.address);

      await displayReactorState(reactor, log);
      expect(await angle.balanceOf(reactor.address)).to.be.equal(0);
      expect(await angle.balanceOf(vaultManager.address)).to.be.equal(totalAsset.sub(assetsAmount));
      expectApprox(
        await vaultManager.getVaultDebt(1),
        totalAsset.sub(assetsAmount).mul(2).mul(targetCF).div(1e9),
        0.00001,
      );
    });
  });
});
