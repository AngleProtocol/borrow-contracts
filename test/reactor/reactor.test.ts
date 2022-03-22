import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BigNumber, Signer, utils } from 'ethers';
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
  Reactor,
  Reactor__factory,
  VaultManager,
  VaultManager__factory,
} from '../../typechain';
import { expect } from '../utils/chai-setup';
import { inIndirectReceipt, inReceipt } from '../utils/expectEvent';
import {
  batch,
  deployUpgradeable,
  displayReactorState,
  displayVaultState,
  expectApprox,
  latestTime,
  MAX_UINT256,
  repayDebt,
  ZERO_ADDRESS,
} from '../utils/helpers';

contract('Reactor', () => {
  const log = true;

  let deployer: SignerWithAddress;
  let governor: SignerWithAddress;
  let guardian: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  let reactor: Reactor;
  let treasury: MockTreasury;
  let ANGLE: MockToken;
  let oracle: MockOracle;
  let stableMaster: MockStableMaster;
  let agEUR: AgToken;
  let vaultManager: VaultManager;
  let lastTime: number;

  const impersonatedSigners: { [key: string]: Signer } = {};

  const collatBase = 9;
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
    stableMaster = await new MockStableMaster__factory(deployer).deploy();

    agEUR = (await deployUpgradeable(new AgToken__factory(deployer))) as AgToken;
    await agEUR.connect(deployer).initialize('agEUR', 'agEUR', stableMaster.address);

    ANGLE = await new MockToken__factory(deployer).deploy('ANGLE', 'ANGLE', collatBase);

    vaultManager = (await deployUpgradeable(new VaultManager__factory(deployer), 0.1e15, 0.1e15)) as VaultManager;

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
    await treasury.addMinter(agEUR.address, bob.address);

    oracle = await new MockOracle__factory(deployer).deploy(parseUnits('2', 18), collatBase, treasury.address);

    stableMaster = await new MockStableMaster__factory(deployer).deploy();

    await vaultManager.initialize(treasury.address, ANGLE.address, oracle.address, params, 'USDC/agEUR');
    await vaultManager.connect(guardian).togglePause();

    reactor = (await deployUpgradeable(new Reactor__factory(deployer))) as Reactor;
    await reactor.initialize(
      'ANGLE/agEUR Reactor',
      'ANGLE/agEUR Reactor',
      vaultManager.address,
      lowerCF,
      targetCF,
      upperCF,
    );
  });
  describe('initialization', () => {
    it('success - correct state and references', async () => {
      expect(await reactor.lowerCF()).to.be.equal(lowerCF);
      expect(await reactor.targetCF()).to.be.equal(targetCF);
      expect(await reactor.upperCF()).to.be.equal(upperCF);
      expect(await reactor.vaultManager()).to.be.equal(vaultManager.address);
      expect(await reactor.treasury()).to.be.equal(treasury.address);
      expect(await reactor.oracle()).to.be.equal(oracle.address);
      expect(await reactor.asset()).to.be.equal(ANGLE.address);
      expect(await reactor.stablecoin()).to.be.equal(agEUR.address);
      expect(await reactor.lastTime()).to.be.equal(await latestTime());
      expect(await ANGLE.allowance(reactor.address, vaultManager.address)).to.be.equal(MAX_UINT256);
      expect(await vaultManager.ownerOf(1)).to.be.equal(reactor.address);
      expect(await ANGLE.decimals()).to.be.equal(collatBase);
      expect(await agEUR.isMinter(vaultManager.address)).to.be.equal(true);
    });
    it('reverts - invalid collateral factor values', async () => {
      reactor = (await deployUpgradeable(new Reactor__factory(deployer))) as Reactor;
      await expect(
        reactor.initialize('ANGLE/agEUR Reactor', 'ANGLE/agEUR Reactor', vaultManager.address, 0, targetCF, upperCF),
      ).to.be.revertedWith('15');
      await expect(
        reactor.initialize(
          'ANGLE/agEUR Reactor',
          'ANGLE/agEUR Reactor',
          vaultManager.address,
          upperCF,
          targetCF,
          upperCF,
        ),
      ).to.be.revertedWith('15');
      await expect(
        reactor.initialize(
          'ANGLE/agEUR Reactor',
          'ANGLE/agEUR Reactor',
          vaultManager.address,
          lowerCF,
          targetCF,
          lowerCF,
        ),
      ).to.be.revertedWith('15');
      await expect(
        reactor.initialize(
          'ANGLE/agEUR Reactor',
          'ANGLE/agEUR Reactor',
          vaultManager.address,
          lowerCF,
          params.collateralFactor,
          upperCF,
        ),
      ).to.be.revertedWith('15');
      await expect(
        reactor.initialize('ANGLE/agEUR Reactor', 'ANGLE/agEUR Reactor', vaultManager.address, lowerCF, targetCF, 1e9),
      ).to.be.revertedWith('15');
    });
  });
  describe('maxMint', () => {
    it('success - correct value when zero balance', async () => {
      expect(await reactor.maxMint(alice.address)).to.be.equal(MAX_UINT256);
      expect(await reactor.maxMint(ZERO_ADDRESS)).to.be.equal(MAX_UINT256);
    });
    it('success - correct value when non-null balance', async () => {
      const sharesAmount = parseUnits('1', collatBase);
      await ANGLE.connect(alice).mint(alice.address, sharesAmount);
      expect(await reactor.maxMint(alice.address)).to.be.equal(MAX_UINT256);
    });
  });
  describe('maxDeposit', () => {
    it('success - correct value when zero balance', async () => {
      expect(await reactor.maxDeposit(alice.address)).to.be.equal(MAX_UINT256);
      expect(await reactor.maxDeposit(ZERO_ADDRESS)).to.be.equal(MAX_UINT256);
    });
    it('success - correct value when non-null balance', async () => {
      const sharesAmount = parseUnits('1', collatBase);
      await ANGLE.connect(alice).mint(alice.address, sharesAmount);
      expect(await reactor.maxDeposit(alice.address)).to.be.equal(MAX_UINT256);
    });
  });
  describe('previewDeposit', () => {
    const sharesAmount = parseUnits('1', collatBase);
    it('success - when no asset', async () => {
      expect(await reactor.previewDeposit(sharesAmount)).to.be.equal(sharesAmount);
    });
    it('success - when some has been minted', async () => {
      await ANGLE.connect(alice).mint(alice.address, sharesAmount);
      await ANGLE.connect(alice).approve(reactor.address, sharesAmount);
      await reactor.connect(alice).mint(sharesAmount, alice.address);
      expect(await reactor.previewDeposit(sharesAmount)).to.be.equal(sharesAmount);
    });
    it('success - when some has been minted and a gain has been made', async () => {
      await ANGLE.connect(alice).mint(alice.address, sharesAmount);
      await ANGLE.connect(alice).approve(reactor.address, sharesAmount);
      await reactor.connect(alice).mint(sharesAmount, alice.address);
      const gains = parseUnits('1', collatBase);
      await ANGLE.mint(reactor.address, gains);
      expect(await reactor.previewDeposit(sharesAmount)).to.be.equal(sharesAmount.div(2));
    });
  });
  describe('previewWithdraw', () => {
    const sharesAmount = parseUnits('1', collatBase);
    it('success - when no asset', async () => {
      expect(await reactor.previewWithdraw(sharesAmount)).to.be.equal(sharesAmount);
    });
    it('success - when some has been minted', async () => {
      await ANGLE.connect(alice).mint(alice.address, sharesAmount);
      await ANGLE.connect(alice).approve(reactor.address, sharesAmount);
      await reactor.connect(alice).mint(sharesAmount, alice.address);
      expect(await reactor.previewWithdraw(sharesAmount)).to.be.equal(sharesAmount);
    });
    it('success - when some has been minted and a gain has been made', async () => {
      await ANGLE.connect(alice).mint(alice.address, sharesAmount);
      await ANGLE.connect(alice).approve(reactor.address, sharesAmount);
      await reactor.connect(alice).mint(sharesAmount, alice.address);
      const gains = parseUnits('1', collatBase);
      await ANGLE.mint(reactor.address, gains);
      expect(await reactor.previewWithdraw(sharesAmount)).to.be.equal(sharesAmount.div(2));
    });
  });
  describe('previewMint', () => {
    const sharesAmount = parseUnits('1', collatBase);
    it('success - when no asset', async () => {
      expect(await reactor.previewMint(sharesAmount)).to.be.equal(sharesAmount);
    });
    it('success - when some has been minted', async () => {
      await ANGLE.connect(alice).mint(alice.address, sharesAmount);
      await ANGLE.connect(alice).approve(reactor.address, sharesAmount);
      await reactor.connect(alice).mint(sharesAmount, alice.address);
      expect(await reactor.previewMint(sharesAmount)).to.be.equal(sharesAmount);
    });
    it('success - when some has been minted and a gain has been made', async () => {
      await ANGLE.connect(alice).mint(alice.address, sharesAmount);
      await ANGLE.connect(alice).approve(reactor.address, sharesAmount);
      await reactor.connect(alice).mint(sharesAmount, alice.address);
      const gains = parseUnits('1', collatBase);
      await ANGLE.mint(reactor.address, gains);
      expect(await reactor.previewMint(sharesAmount)).to.be.equal(sharesAmount.mul(2));
    });
  });
  describe('previewRedeem', () => {
    const sharesAmount = parseUnits('1', collatBase);
    it('success - when no asset', async () => {
      expect(await reactor.previewRedeem(sharesAmount)).to.be.equal(sharesAmount);
    });
    it('success - when some has been minted', async () => {
      await ANGLE.connect(alice).mint(alice.address, sharesAmount);
      await ANGLE.connect(alice).approve(reactor.address, sharesAmount);
      await reactor.connect(alice).mint(sharesAmount, alice.address);
      expect(await reactor.previewRedeem(sharesAmount)).to.be.equal(sharesAmount);
    });
    it('success - when some has been minted and a gain has been made', async () => {
      await ANGLE.connect(alice).mint(alice.address, sharesAmount);
      await ANGLE.connect(alice).approve(reactor.address, sharesAmount);
      await reactor.connect(alice).mint(sharesAmount, alice.address);
      const gains = parseUnits('1', collatBase);
      await ANGLE.mint(reactor.address, gains);
      expect(await reactor.previewRedeem(sharesAmount)).to.be.equal(sharesAmount.mul(2));
    });
  });
  describe('maxWithdraw', () => {
    const sharesAmount = parseUnits('1', collatBase);
    it('success - when no asset', async () => {
      expect(await reactor.maxWithdraw(alice.address)).to.be.equal(0);
    });
    it('success - when some has been minted', async () => {
      await ANGLE.connect(alice).mint(alice.address, sharesAmount);
      await ANGLE.connect(alice).approve(reactor.address, sharesAmount);
      await reactor.connect(alice).mint(sharesAmount, alice.address);
      expect(await reactor.maxWithdraw(alice.address)).to.be.equal(sharesAmount);
    });
    it('success - when some has been minted and a gain has been made', async () => {
      await ANGLE.connect(alice).mint(alice.address, sharesAmount);
      await ANGLE.connect(alice).approve(reactor.address, sharesAmount);
      await reactor.connect(alice).mint(sharesAmount, alice.address);
      const gains = parseUnits('1', collatBase);
      await ANGLE.mint(reactor.address, gains);
      expect(await reactor.maxWithdraw(alice.address)).to.be.equal(sharesAmount.div(2));
    });
  });
  describe('maxRedeem', () => {
    const sharesAmount = parseUnits('1', collatBase);
    it('success - when no asset', async () => {
      expect(await reactor.maxRedeem(alice.address)).to.be.equal(0);
    });
    it('success - when some has been minted', async () => {
      await ANGLE.connect(alice).mint(alice.address, sharesAmount);
      await ANGLE.connect(alice).approve(reactor.address, sharesAmount);
      await reactor.connect(alice).mint(sharesAmount, alice.address);
      expect(await reactor.maxRedeem(alice.address)).to.be.equal(sharesAmount);
    });
    it('success - when some has been minted and a gain has been made', async () => {
      await ANGLE.connect(alice).mint(alice.address, sharesAmount);
      await ANGLE.connect(alice).approve(reactor.address, sharesAmount);
      await reactor.connect(alice).mint(sharesAmount, alice.address);
      const gains = parseUnits('1', collatBase);
      await ANGLE.mint(reactor.address, gains);
      // It's still the balance of the user
      expect(await reactor.maxRedeem(alice.address)).to.be.equal(sharesAmount);
    });
  });
  describe('onERC721Received', () => {
    it('reverts - sender is not vaultManager', async () => {
      await expect(reactor.onERC721Received(alice.address, alice.address, 0, '0x')).to.be.revertedWith('3');
    });
  });
  describe('setOracle', () => {
    it('success - when value has not changed', async () => {
      await reactor.setOracle();
      expect(await reactor.oracle()).to.be.equal(oracle.address);
    });
    it('success - when value has changed', async () => {
      const newOracle = await new MockOracle__factory(deployer).deploy(parseUnits('2', 18), 1, treasury.address);
      await vaultManager.connect(governor).setOracle(newOracle.address);
      expect(await vaultManager.oracle()).to.be.equal(newOracle.address);
      await reactor.setOracle();
      expect(await reactor.oracle()).to.be.equal(newOracle.address);
    });
  });
  describe('setTreasury', () => {
    it('success - when value has not changed', async () => {
      await reactor.setTreasury();
      expect(await reactor.treasury()).to.be.equal(treasury.address);
    });
    it('success - when value has changed', async () => {
      await treasury.connect(governor).setTreasury(vaultManager.address, agEUR.address);
      expect(await vaultManager.treasury()).to.be.equal(agEUR.address);
      await reactor.setTreasury();
      expect(await reactor.treasury()).to.be.equal(agEUR.address);
    });
  });

  describe('setDust', () => {
    it('success - when value has not changed', async () => {
      await reactor.setDust();
      expect(await reactor.vaultManagerDust()).to.be.equal(0.1e15);
    });
  });

  describe('setUint64', () => {
    it('reverts - access control', async () => {
      await expect(reactor.connect(alice).setUint64(lowerCF, formatBytes32String('lowerCF'))).to.be.revertedWith('2');
    });
    it('success - guardian and lowerCF', async () => {
      const receipt = await (await reactor.connect(guardian).setUint64(0.1e9, formatBytes32String('lowerCF'))).wait();
      inReceipt(receipt, 'FiledUint64', {
        param: 0.1e9,
        what: formatBytes32String('lowerCF'),
      });
      expect(await reactor.lowerCF()).to.be.equal(0.1e9);
    });
    it('success - governor and lowerCF', async () => {
      await reactor.connect(governor).setUint64(0.1e9, formatBytes32String('lowerCF'));
      expect(await reactor.lowerCF()).to.be.equal(0.1e9);
    });
    it('success - targetCF', async () => {
      const receipt = await (await reactor.connect(governor).setUint64(0.5e9, formatBytes32String('targetCF'))).wait();
      expect(await reactor.targetCF()).to.be.equal(0.5e9);
      inReceipt(receipt, 'FiledUint64', {
        param: 0.5e9,
        what: formatBytes32String('targetCF'),
      });
    });
    it('success - upperCF', async () => {
      const receipt = await (await reactor.connect(governor).setUint64(0.7e9, formatBytes32String('upperCF'))).wait();
      expect(await reactor.upperCF()).to.be.equal(0.7e9);
      inReceipt(receipt, 'FiledUint64', {
        param: 0.7e9,
        what: formatBytes32String('upperCF'),
      });
    });
    it('reverts - invalid lowerCF', async () => {
      await expect(reactor.connect(governor).setUint64(0.6e9, formatBytes32String('lowerCF'))).to.be.revertedWith('18');
      await expect(reactor.connect(governor).setUint64(0, formatBytes32String('lowerCF'))).to.be.revertedWith('18');
    });
    it('reverts - invalid targetCF', async () => {
      await expect(reactor.connect(governor).setUint64(1e9, formatBytes32String('targetCF'))).to.be.revertedWith('18');
      await expect(reactor.connect(governor).setUint64(0, formatBytes32String('targetCF'))).to.be.revertedWith('18');
    });
    it('reverts - invalid upperCF', async () => {
      await expect(reactor.connect(governor).setUint64(1e9, formatBytes32String('upperCF'))).to.be.revertedWith('18');
      await expect(reactor.connect(governor).setUint64(0, formatBytes32String('upperCF'))).to.be.revertedWith('18');
    });
    it('reverts - invalid parameter', async () => {
      await expect(reactor.connect(governor).setUint64(1e9, formatBytes32String('wrong message'))).to.be.revertedWith(
        '43',
      );
    });
  });
  describe('recoverERC20', () => {
    it('reverts - nonGovernor', async () => {
      await expect(reactor.recoverERC20(agEUR.address, bob.address, 1)).to.be.revertedWith('1');
    });
    it('success - when token is collateral', async () => {
      const gains = parseUnits('1', collatBase);
      await ANGLE.mint(reactor.address, gains);
      const receipt = await (await reactor.connect(governor).recoverERC20(ANGLE.address, bob.address, gains)).wait();
      inReceipt(receipt, 'Recovered', {
        token: ANGLE.address,
        to: bob.address,
        amount: gains,
      });
      expect(await ANGLE.balanceOf(bob.address)).to.be.equal(gains);
      expect(await ANGLE.balanceOf(reactor.address)).to.be.equal(0);
    });
    it('reverts - when token is stablecoin', async () => {
      await treasury.addMinter(agEUR.address, alice.address);
      await agEUR.connect(alice).mint(reactor.address, parseEther('1'));
      await expect(reactor.connect(governor).recoverERC20(agEUR.address, bob.address, 1)).to.be.revertedWith('51');
    });
  });

  describe('mint', () => {
    const sharesAmount = parseUnits('1', collatBase);
    beforeEach(async () => {
      await ANGLE.connect(alice).mint(alice.address, sharesAmount);
      await ANGLE.connect(alice).approve(reactor.address, sharesAmount);
      await reactor.connect(alice).mint(sharesAmount, alice.address);
      lastTime = await latestTime();
    });

    it('success - added collateral to vault', async () => {
      await displayReactorState(reactor, log);
      expect(await ANGLE.balanceOf(reactor.address)).to.be.equal(0);
      expect(await ANGLE.balanceOf(vaultManager.address)).to.be.equal(sharesAmount);
      expect(await reactor.balanceOf(alice.address)).to.be.equal(sharesAmount);
      expect(await reactor.lastTime()).to.be.equal(lastTime);
      expect(await reactor.lastTimeOf(alice.address)).to.be.equal(lastTime);
      expect(await reactor.rewardsAccumulatorOf(alice.address)).to.be.equal(0);
      expect(await reactor.rewardsAccumulator()).to.be.equal(0);
      // It works here as collatBase is 9 (= base params) and base of the stablecoin is 18
      expectApprox(await vaultManager.getVaultDebt(1), sharesAmount.mul(2).mul(targetCF), 0.00001);
    });
    it('success - mint when there is a gain in stablecoins', async () => {
      const sharesAmount = parseUnits('1', collatBase);
      await ANGLE.connect(alice).mint(alice.address, sharesAmount.mul(100));
      await ANGLE.connect(alice).approve(reactor.address, sharesAmount.mul(100));
      // Shares amount is consumed
      expectApprox(await vaultManager.getVaultDebt(1), sharesAmount.mul(2).mul(targetCF), 0.00001);
      await treasury.addMinter(agEUR.address, bob.address);
      await agEUR.connect(bob).mint(bob.address, parseEther('1'));
      // To make a gain we need to repay debt on behalf of the vault
      await batch(vaultManager, bob, [repayDebt(1, parseEther('1'))]);
      await reactor.connect(alice).mint(sharesAmount, alice.address);
      expect(await ANGLE.balanceOf(alice.address)).to.be.equal(sharesAmount.mul(99));
      expect(await reactor.lastDebt()).to.be.equal(parseEther('1.6'));
      expect(await reactor.currentLoss()).to.be.equal(parseEther('0'));
      const claimable = await reactor.claimableRewards();
      expectApprox(claimable, parseEther('0.8'), 0.00001);
    });

    it('success - second mint with borrow', async () => {
      const secondSharesAmount = sharesAmount;
      await ANGLE.connect(alice).mint(alice.address, secondSharesAmount);
      await ANGLE.connect(alice).approve(reactor.address, secondSharesAmount);
      const receipt = await (await reactor.connect(alice).mint(secondSharesAmount, alice.address)).wait();
      inReceipt(receipt, 'Deposit', {
        from: alice.address,
        to: alice.address,
        amount: secondSharesAmount,
        shares: secondSharesAmount,
      });
      inReceipt(receipt, 'Transfer', {
        from: ZERO_ADDRESS,
        to: alice.address,
        value: secondSharesAmount,
      });
      await displayReactorState(reactor, log);
      expect(await ANGLE.balanceOf(reactor.address)).to.be.equal(0);
      expect(await ANGLE.balanceOf(vaultManager.address)).to.be.equal(sharesAmount.add(secondSharesAmount));
      expect(await reactor.balanceOf(alice.address)).to.be.equal(sharesAmount.add(secondSharesAmount));
      expect(await reactor.lastTime()).to.be.equal(await latestTime());
      expect(await reactor.lastTimeOf(alice.address)).to.be.equal(await latestTime());
      expect(await reactor.rewardsAccumulatorOf(alice.address)).to.be.equal(
        BigNumber.from((await latestTime()) - lastTime).mul(sharesAmount),
      );
      expect(await reactor.rewardsAccumulator()).to.be.equal(
        BigNumber.from((await latestTime()) - lastTime).mul(sharesAmount),
      );
      expectApprox(
        await vaultManager.getVaultDebt(1),
        sharesAmount.add(secondSharesAmount).mul(2).mul(targetCF),
        0.00001,
      );
    });
    it('success - second mint to a different address', async () => {
      const secondSharesAmount = sharesAmount;
      await ANGLE.connect(alice).mint(alice.address, secondSharesAmount);
      await ANGLE.connect(alice).approve(reactor.address, secondSharesAmount);
      const receipt = await (await reactor.connect(alice).mint(secondSharesAmount, bob.address)).wait();
      inReceipt(receipt, 'Deposit', {
        from: alice.address,
        to: bob.address,
        amount: secondSharesAmount,
        shares: secondSharesAmount,
      });
      inReceipt(receipt, 'Transfer', {
        from: ZERO_ADDRESS,
        to: bob.address,
        value: secondSharesAmount,
      });
      expect(await ANGLE.balanceOf(reactor.address)).to.be.equal(0);
      expect(await ANGLE.balanceOf(vaultManager.address)).to.be.equal(sharesAmount.add(secondSharesAmount));
      expect(await reactor.balanceOf(alice.address)).to.be.equal(sharesAmount);
      expect(await reactor.balanceOf(bob.address)).to.be.equal(secondSharesAmount);
      expect(await reactor.lastTime()).to.be.equal(await latestTime());
      expect(await reactor.lastTimeOf(alice.address)).to.be.equal(lastTime);
      expect(await reactor.lastTimeOf(bob.address)).to.be.equal(await latestTime());
      expect(await reactor.rewardsAccumulatorOf(alice.address)).to.be.equal(0);
      expect(await reactor.rewardsAccumulatorOf(bob.address)).to.be.equal(0);
      expect(await reactor.rewardsAccumulator()).to.be.equal(
        BigNumber.from((await latestTime()) - lastTime).mul(sharesAmount),
      );
      expectApprox(
        await vaultManager.getVaultDebt(1),
        sharesAmount.add(secondSharesAmount).mul(2).mul(targetCF),
        0.00001,
      );
    });

    it('success - second mint without borrow', async () => {
      const secondSharesAmount = parseUnits('0.4', collatBase);
      await ANGLE.connect(alice).mint(alice.address, secondSharesAmount);
      await ANGLE.connect(alice).approve(reactor.address, secondSharesAmount);
      const receipt = await (await reactor.connect(alice).mint(secondSharesAmount, alice.address)).wait();
      inReceipt(receipt, 'Deposit', {
        from: alice.address,
        to: alice.address,
        amount: secondSharesAmount,
        shares: secondSharesAmount,
      });
      inReceipt(receipt, 'Transfer', {
        from: ZERO_ADDRESS,
        to: alice.address,
        value: secondSharesAmount,
      });

      await displayReactorState(reactor, log);

      expect(await ANGLE.balanceOf(reactor.address)).to.be.equal(0);
      expect(await ANGLE.balanceOf(vaultManager.address)).to.be.equal(sharesAmount.add(secondSharesAmount));
      // Does not change below or above the collateral ratio so it does not change anything
      expectApprox(await vaultManager.getVaultDebt(1), sharesAmount.mul(2).mul(targetCF), 0.00001);
    });

    it('success - second mint after gain', async () => {
      const gains = parseUnits('1', collatBase);
      await ANGLE.mint(reactor.address, gains);

      const secondSharesAmount = parseUnits('0.2', collatBase);
      const secondAssetAmount = parseUnits('0.4', collatBase);
      await ANGLE.connect(alice).mint(alice.address, secondAssetAmount);
      await ANGLE.connect(alice).approve(reactor.address, secondAssetAmount);
      await reactor.connect(alice).mint(secondSharesAmount, alice.address);

      await displayReactorState(reactor, log);

      expect(await ANGLE.balanceOf(reactor.address)).to.be.equal(0);
      expect(await ANGLE.balanceOf(vaultManager.address)).to.be.equal(sharesAmount.add(secondAssetAmount).add(gains));
      expectApprox(
        await vaultManager.getVaultDebt(1),
        sharesAmount.add(secondAssetAmount).add(gains).mul(2).mul(targetCF),
        0.00001,
      );
    });
  });

  describe('rebalance', () => {
    const sharesAmount = parseUnits('1', collatBase);
    beforeEach(async () => {
      await ANGLE.connect(alice).mint(alice.address, sharesAmount);
      await ANGLE.connect(alice).approve(reactor.address, sharesAmount);
      await reactor.connect(alice).mint(sharesAmount, alice.address);
      lastTime = await latestTime();
    });
    it('success - correctly rebalances after a gain in collateral', async () => {
      await ANGLE.connect(alice).mint(reactor.address, sharesAmount);
      await reactor.rebalance();
      await displayReactorState(reactor, log);
      expect(await ANGLE.balanceOf(reactor.address)).to.be.equal(0);
      expect(await ANGLE.balanceOf(vaultManager.address)).to.be.equal(sharesAmount.mul(2));
      expect(await reactor.balanceOf(alice.address)).to.be.equal(sharesAmount);
      // Last time should remain unchanged
      expect(await reactor.lastTime()).to.be.equal(lastTime);
      expect(await reactor.lastTimeOf(alice.address)).to.be.equal(lastTime);
      expectApprox(await vaultManager.getVaultDebt(1), sharesAmount.mul(4).mul(targetCF), 0.00001);
    });
    it('success - correctly rebalances after a gain in stablecoin', async () => {
      await treasury.addMinter(agEUR.address, bob.address);
      await agEUR.connect(bob).mint(bob.address, parseEther('1'));
      // To make a gain we need to repay debt on behalf of the vault
      await batch(vaultManager, bob, [repayDebt(1, parseEther('1'))]);
      await reactor.rebalance();
      expect(await reactor.claimableRewards()).to.be.equal(parseEther('0.8'));
      // State of the reactor should not change otherwise
      expectApprox(await vaultManager.getVaultDebt(1), sharesAmount.mul(2).mul(targetCF), 0.00001);
      expect(await ANGLE.balanceOf(reactor.address)).to.be.equal(0);
      expect(await ANGLE.balanceOf(vaultManager.address)).to.be.equal(sharesAmount.mul(1));
      expect(await reactor.balanceOf(alice.address)).to.be.equal(sharesAmount);
      // Last time should remain unchanged
      expect(await reactor.lastTime()).to.be.equal(lastTime);
      expect(await reactor.lastTimeOf(alice.address)).to.be.equal(lastTime);
    });
  });

  describe('deposit', () => {
    const assetsAmount = parseUnits('1', collatBase);
    beforeEach(async () => {
      await ANGLE.connect(alice).mint(alice.address, assetsAmount);
      await ANGLE.connect(alice).approve(reactor.address, assetsAmount);
      await reactor.connect(alice).deposit(assetsAmount, alice.address);
    });

    it('success - added collateral to vault', async () => {
      await displayReactorState(reactor, log);
      expect(await ANGLE.balanceOf(reactor.address)).to.be.equal(0);
      expect(await ANGLE.balanceOf(vaultManager.address)).to.be.equal(assetsAmount);
      expectApprox(await vaultManager.getVaultDebt(1), assetsAmount.mul(2).mul(targetCF), 0.00001);
    });
    it('reverts - zero shares', async () => {
      await expect(reactor.connect(alice).deposit(0, alice.address)).to.be.revertedWith('ZERO_SHARES');
    });
  });

  describe('redeem', () => {
    const sharesAmount = parseUnits('0.8', collatBase);
    const assetsAmount = parseUnits('1.6', collatBase);
    const totalAsset = parseUnits('2', collatBase);

    beforeEach(async () => {
      await ANGLE.connect(alice).mint(alice.address, parseUnits('1', collatBase));
      await ANGLE.connect(alice).approve(reactor.address, parseUnits('1', collatBase));
      await reactor.connect(alice).mint(parseUnits('1', collatBase), alice.address);
      await ANGLE.mint(reactor.address, parseUnits('1', collatBase));
    });

    it('success - from/to are the same address', async () => {
      await displayReactorState(reactor, log);
      expect(await reactor.balanceOf(alice.address)).to.be.equal(parseUnits('1', collatBase));
      await reactor.connect(alice).redeem(sharesAmount, alice.address, alice.address);
      expect(await reactor.balanceOf(alice.address)).to.be.equal(parseUnits('0.2', collatBase));
      await displayReactorState(reactor, log);
      expect(await ANGLE.balanceOf(reactor.address)).to.be.equal(0);
      expect(await ANGLE.balanceOf(vaultManager.address)).to.be.equal(totalAsset.sub(assetsAmount));
      expect(await ANGLE.balanceOf(alice.address)).to.be.equal(assetsAmount);
      expectApprox(await vaultManager.getVaultDebt(1), totalAsset.sub(assetsAmount).mul(2).mul(targetCF), 0.00001);
    });
    it('reverts - from not approved by msg.sender', async () => {
      await expect(reactor.connect(bob).redeem(sharesAmount, alice.address, alice.address)).to.be.revertedWith(
        'ERC20: transfer amount exceeds allowance',
      );
    });
    it('reverts - redeems more shares', async () => {
      await expect(reactor.connect(alice).withdraw(assetsAmount.mul(1000), alice.address, alice.address)).to.be
        .reverted;
    });
    it('reverts - zero assets', async () => {
      await expect(reactor.connect(bob).redeem(0, alice.address, alice.address)).to.be.revertedWith('ZERO_ASSETS');
    });
    it('success - from approved by msg.sender and reduced allowance', async () => {
      await reactor.connect(alice).approve(bob.address, sharesAmount);
      const receipt = await (await reactor.connect(bob).redeem(sharesAmount, alice.address, alice.address)).wait();
      inReceipt(receipt, 'Withdraw', {
        from: alice.address,
        to: alice.address,
        amount: assetsAmount,
        shares: sharesAmount,
      });
      inIndirectReceipt(
        receipt,
        new utils.Interface(['event Transfer(address indexed from, address indexed to, uint256 value)']),
        'Transfer',
        {
          from: reactor.address,
          to: alice.address,
          value: assetsAmount,
        },
      );
      expect(await reactor.balanceOf(alice.address)).to.be.equal(parseUnits('0.2', collatBase));
      expect(await ANGLE.balanceOf(reactor.address)).to.be.equal(0);
      expect(await ANGLE.balanceOf(vaultManager.address)).to.be.equal(totalAsset.sub(assetsAmount));
      expect(await ANGLE.balanceOf(alice.address)).to.be.equal(assetsAmount);
      expect(await reactor.allowance(alice.address, bob.address)).to.be.equal(0);
      expectApprox(await vaultManager.getVaultDebt(1), totalAsset.sub(assetsAmount).mul(2).mul(targetCF), 0.00001);
    });
    it('success - from approved by msg.sender and different to address', async () => {
      await reactor.connect(alice).approve(bob.address, sharesAmount);
      const receipt = await (await reactor.connect(bob).redeem(sharesAmount, bob.address, alice.address)).wait();
      inReceipt(receipt, 'Withdraw', {
        from: alice.address,
        to: bob.address,
        amount: assetsAmount,
        shares: sharesAmount,
      });
      inIndirectReceipt(
        receipt,
        new utils.Interface(['event Transfer(address indexed from, address indexed to, uint256 value)']),
        'Transfer',
        {
          from: reactor.address,
          to: bob.address,
          value: assetsAmount,
        },
      );
      expect(await reactor.balanceOf(alice.address)).to.be.equal(parseUnits('0.2', collatBase));
      expect(await ANGLE.balanceOf(reactor.address)).to.be.equal(0);
      expect(await ANGLE.balanceOf(vaultManager.address)).to.be.equal(totalAsset.sub(assetsAmount));
      expect(await ANGLE.balanceOf(bob.address)).to.be.equal(assetsAmount);
      expect(await ANGLE.balanceOf(alice.address)).to.be.equal(0);
      expect(await reactor.allowance(alice.address, bob.address)).to.be.equal(0);
      expectApprox(await vaultManager.getVaultDebt(1), totalAsset.sub(assetsAmount).mul(2).mul(targetCF), 0.00001);
    });
    it('success - from approved by msg.sender and different to address with a max approval', async () => {
      await reactor.connect(alice).approve(bob.address, MAX_UINT256);
      await reactor.connect(bob).redeem(sharesAmount, bob.address, alice.address);
      expect(await reactor.balanceOf(alice.address)).to.be.equal(parseUnits('0.2', collatBase));
      expect(await ANGLE.balanceOf(reactor.address)).to.be.equal(0);
      expect(await ANGLE.balanceOf(vaultManager.address)).to.be.equal(totalAsset.sub(assetsAmount));
      expect(await ANGLE.balanceOf(bob.address)).to.be.equal(assetsAmount);
      expect(await ANGLE.balanceOf(alice.address)).to.be.equal(0);
      expect(await reactor.allowance(alice.address, bob.address)).to.be.equal(MAX_UINT256);
      expectApprox(await vaultManager.getVaultDebt(1), totalAsset.sub(assetsAmount).mul(2).mul(targetCF), 0.00001);
    });
  });
  describe('withdraw', () => {
    const sharesAmount = parseUnits('0.8', collatBase);
    const assetsAmount = parseUnits('1.6', collatBase);
    const totalAsset = parseUnits('2', collatBase);

    beforeEach(async () => {
      await ANGLE.connect(alice).mint(alice.address, parseUnits('1', collatBase));
      await ANGLE.connect(alice).approve(reactor.address, parseUnits('1', collatBase));
      await reactor.connect(alice).mint(parseUnits('1', collatBase), alice.address);
      await ANGLE.mint(reactor.address, parseUnits('1', collatBase));
    });

    it('success - from/to are the same address', async () => {
      await displayReactorState(reactor, log);
      expect(await reactor.balanceOf(alice.address)).to.be.equal(parseUnits('1', collatBase));
      await reactor.connect(alice).withdraw(assetsAmount, alice.address, alice.address);
      expect(await reactor.balanceOf(alice.address)).to.be.equal(parseUnits('0.2', collatBase));
      expect(await ANGLE.balanceOf(reactor.address)).to.be.equal(0);
      expect(await ANGLE.balanceOf(vaultManager.address)).to.be.equal(totalAsset.sub(assetsAmount));
      expect(await ANGLE.balanceOf(alice.address)).to.be.equal(assetsAmount);
      expectApprox(await vaultManager.getVaultDebt(1), totalAsset.sub(assetsAmount).mul(2).mul(targetCF), 0.00001);
    });
    it('reverts - from not approved by msg.sender', async () => {
      await expect(reactor.connect(bob).withdraw(assetsAmount, alice.address, alice.address)).to.be.revertedWith(
        'ERC20: transfer amount exceeds allowance',
      );
    });
    it('reverts - withdraw more than what is in the reactor', async () => {
      await expect(reactor.connect(alice).withdraw(assetsAmount.mul(1000), alice.address, alice.address)).to.be
        .reverted;
    });
    it('success - from approved by msg.sender and reduced allowance', async () => {
      await reactor.connect(alice).approve(bob.address, sharesAmount);
      const receipt = await (await reactor.connect(bob).withdraw(assetsAmount, alice.address, alice.address)).wait();
      inReceipt(receipt, 'Withdraw', {
        from: alice.address,
        to: alice.address,
        amount: assetsAmount,
        shares: sharesAmount,
      });
      inIndirectReceipt(
        receipt,
        new utils.Interface(['event Transfer(address indexed from, address indexed to, uint256 value)']),
        'Transfer',
        {
          from: reactor.address,
          to: alice.address,
          value: assetsAmount,
        },
      );
      expect(await reactor.balanceOf(alice.address)).to.be.equal(parseUnits('0.2', collatBase));
      expect(await ANGLE.balanceOf(reactor.address)).to.be.equal(0);
      expect(await ANGLE.balanceOf(vaultManager.address)).to.be.equal(totalAsset.sub(assetsAmount));
      expect(await ANGLE.balanceOf(alice.address)).to.be.equal(assetsAmount);
      expect(await reactor.allowance(alice.address, bob.address)).to.be.equal(0);
      expectApprox(await vaultManager.getVaultDebt(1), totalAsset.sub(assetsAmount).mul(2).mul(targetCF), 0.00001);
    });
    it('success - from approved by msg.sender and different to address', async () => {
      await reactor.connect(alice).approve(bob.address, sharesAmount);
      const receipt = await (await reactor.connect(bob).withdraw(assetsAmount, bob.address, alice.address)).wait();
      inReceipt(receipt, 'Withdraw', {
        from: alice.address,
        to: bob.address,
        amount: assetsAmount,
        shares: sharesAmount,
      });
      inIndirectReceipt(
        receipt,
        new utils.Interface(['event Transfer(address indexed from, address indexed to, uint256 value)']),
        'Transfer',
        {
          from: reactor.address,
          to: bob.address,
          value: assetsAmount,
        },
      );
      expect(await reactor.balanceOf(alice.address)).to.be.equal(parseUnits('0.2', collatBase));
      expect(await ANGLE.balanceOf(reactor.address)).to.be.equal(0);
      expect(await ANGLE.balanceOf(vaultManager.address)).to.be.equal(totalAsset.sub(assetsAmount));
      expect(await ANGLE.balanceOf(bob.address)).to.be.equal(assetsAmount);
      expect(await ANGLE.balanceOf(alice.address)).to.be.equal(0);
      expect(await reactor.allowance(alice.address, bob.address)).to.be.equal(0);
      expectApprox(await vaultManager.getVaultDebt(1), totalAsset.sub(assetsAmount).mul(2).mul(targetCF), 0.00001);
    });
    it('success - from approved by msg.sender and different to address with a max approval', async () => {
      await reactor.connect(alice).approve(bob.address, MAX_UINT256);
      await reactor.connect(bob).withdraw(assetsAmount, bob.address, alice.address);
      expect(await reactor.balanceOf(alice.address)).to.be.equal(parseUnits('0.2', collatBase));
      expect(await ANGLE.balanceOf(reactor.address)).to.be.equal(0);
      expect(await ANGLE.balanceOf(vaultManager.address)).to.be.equal(totalAsset.sub(assetsAmount));
      expect(await ANGLE.balanceOf(bob.address)).to.be.equal(assetsAmount);
      expect(await ANGLE.balanceOf(alice.address)).to.be.equal(0);
      expect(await reactor.allowance(alice.address, bob.address)).to.be.equal(MAX_UINT256);
      expectApprox(await vaultManager.getVaultDebt(1), totalAsset.sub(assetsAmount).mul(2).mul(targetCF), 0.00001);
    });
  });
  describe('claim', () => {
    it('reverts - when nothing in the reactor because division by zero', async () => {
      await expect(reactor.connect(alice).claim(alice.address)).to.be.reverted;
    });
    it('reverts - when 0 claimable rewards', async () => {
      await expect(reactor.connect(alice).claim(alice.address)).to.be.reverted;
    });
    it('success - when there are claimable rewards', async () => {
      const sharesAmount = parseUnits('1', collatBase);
      await ANGLE.connect(alice).mint(alice.address, sharesAmount.mul(100));
      await ANGLE.connect(alice).approve(reactor.address, sharesAmount.mul(100));
      // Shares amount is consumed
      await reactor.connect(alice).mint(sharesAmount, alice.address);
      expect(await ANGLE.balanceOf(alice.address)).to.be.equal(sharesAmount.mul(99));
      expectApprox(await vaultManager.getVaultDebt(1), sharesAmount.mul(2).mul(targetCF), 0.00001);
      await treasury.addMinter(agEUR.address, bob.address);
      await agEUR.connect(bob).mint(bob.address, parseEther('1'));
      // To make a gain we need to repay debt on behalf of the vault
      await batch(vaultManager, bob, [repayDebt(1, parseEther('1'))]);
      await reactor.connect(alice).mint(sharesAmount, alice.address);
      expect(await ANGLE.balanceOf(alice.address)).to.be.equal(sharesAmount.mul(98));
      expect(await reactor.lastDebt()).to.be.equal(parseEther('1.6'));
      expect(await reactor.currentLoss()).to.be.equal(parseEther('0'));
      const claimable = await reactor.claimableRewards();
      expectApprox(claimable, parseEther('0.8'), 0.00001);
      await reactor.claim(alice.address);
      // In this implementation, `pull` just returns 0
      expect(await agEUR.balanceOf(alice.address)).to.be.equal(0);
      expect(await reactor.claimableRewards()).to.be.equal(0);
      expect(await reactor.rewardsAccumulatorOf(alice.address)).to.be.equal(0);
      expect(await reactor.lastTimeOf(alice.address)).to.be.equal(await latestTime());
      expect(await reactor.claimedRewardsAccumulator()).to.be.equal(await reactor.rewardsAccumulator());
    });
    it('success - when there are claimable rewards but that a small loss decreased it', async () => {
      const sharesAmount = parseUnits('1', collatBase);
      await ANGLE.connect(alice).mint(alice.address, sharesAmount.mul(100));
      await ANGLE.connect(alice).approve(reactor.address, sharesAmount.mul(100));
      // Shares amount is consumed
      await reactor.connect(alice).mint(sharesAmount, alice.address);
      expect(await ANGLE.balanceOf(alice.address)).to.be.equal(sharesAmount.mul(99));
      expectApprox(await vaultManager.getVaultDebt(1), sharesAmount.mul(2).mul(targetCF), 0.00001);
      await treasury.addMinter(agEUR.address, bob.address);
      await agEUR.connect(bob).mint(bob.address, parseEther('1'));
      // To make a gain we need to repay debt on behalf of the vault
      await batch(vaultManager, bob, [repayDebt(1, parseEther('1'))]);
      // Here we record a gain
      await reactor.connect(alice).mint(sharesAmount, alice.address);
      expect(await ANGLE.balanceOf(alice.address)).to.be.equal(sharesAmount.mul(98));
      // But here we record a loss since interest have been taken in the meantime
      await reactor.connect(alice).mint(sharesAmount, alice.address);
      expect(await ANGLE.balanceOf(alice.address)).to.be.equal(sharesAmount.mul(97));
      expectApprox(await reactor.lastDebt(), parseEther('1.6'), 0.0001);
      expect(await reactor.currentLoss()).to.be.equal(parseEther('0'));
      // There are still claimable rewards
      const claimable = await reactor.claimableRewards();
      expectApprox(claimable, parseEther('0.8'), 0.00001);
      await reactor.claim(alice.address);
      // In this implementation, `pull` just returns 0
      expect(await agEUR.balanceOf(alice.address)).to.be.equal(0);
      expect(await reactor.claimableRewards()).to.be.equal(0);
      expect(await reactor.rewardsAccumulatorOf(alice.address)).to.be.equal(0);
      expect(await reactor.lastTimeOf(alice.address)).to.be.equal(await latestTime());
      expect(await reactor.claimedRewardsAccumulator()).to.be.equal(await reactor.rewardsAccumulator());
    });
  });
  describe('scenari', () => {
    it('success - nothing borrowed because dusty amount', async () => {
      const sharesAmount = parseUnits('1', collatBase);
      await ANGLE.connect(alice).mint(alice.address, sharesAmount.mul(100));
      await ANGLE.connect(alice).approve(reactor.address, sharesAmount.mul(100));
      await agEUR.connect(bob).mint(bob.address, parseEther('1000'));
      // Shares amount is consumed
      await reactor.connect(alice).mint(100, alice.address);
      expect(await vaultManager.getVaultDebt(1)).to.be.equal(0);
      expect(await ANGLE.balanceOf(reactor.address)).to.be.equal(0);
      expect((await vaultManager.vaultData(1)).collateralAmount).to.be.equal(100);
    });
    it('reverts - everything repaid because dusty amount but not enough stablecoins in balance', async () => {
      const sharesAmount = parseUnits('1', collatBase);
      await ANGLE.connect(alice).mint(alice.address, sharesAmount.mul(100));
      await ANGLE.connect(alice).approve(reactor.address, sharesAmount.mul(100));
      await agEUR.connect(bob).mint(bob.address, parseEther('1000'));
      await reactor.connect(alice).mint(sharesAmount, alice.address);
      expectApprox(await vaultManager.getVaultDebt(1), parseEther('0.8'), 0.00001);
      expect(await ANGLE.balanceOf(reactor.address)).to.be.equal(0);
      expect((await vaultManager.vaultData(1)).collateralAmount).to.be.equal(sharesAmount);
      // Here the strategy cannot reimburse it all
      await expect(reactor.connect(alice).withdraw(parseUnits('0.999999', collatBase), alice.address, alice.address)).to
        .be.reverted;
    });
    it('reverts - everything repaid because dusty amount but not enough stablecoins in balance', async () => {
      const sharesAmount = parseUnits('1', collatBase);
      await ANGLE.connect(alice).mint(alice.address, sharesAmount.mul(100));
      await ANGLE.connect(alice).approve(reactor.address, sharesAmount.mul(100));
      await agEUR.connect(bob).mint(bob.address, parseEther('1000'));
      await reactor.connect(alice).mint(sharesAmount, alice.address);
      expectApprox(await vaultManager.getVaultDebt(1), parseEther('0.8'), 0.00001);
      expect(await ANGLE.balanceOf(reactor.address)).to.be.equal(0);
      expect((await vaultManager.vaultData(1)).collateralAmount).to.be.equal(sharesAmount);
      // Here the strategy cannot reimburse it all
      await agEUR.connect(bob).mint(reactor.address, parseEther('0.1'));
      await reactor.connect(alice).withdraw(parseUnits('0.999999', collatBase), alice.address, alice.address);
      expect(await vaultManager.getVaultDebt(1)).to.be.equal(parseEther('0'));
      expect((await vaultManager.vaultData(1)).collateralAmount).to.be.gt(0);
    });

    it('reverts - liquidation and no asset left in the reactor', async () => {
      const sharesAmount = parseUnits('1', collatBase);
      await ANGLE.connect(alice).mint(alice.address, sharesAmount.mul(100));
      await ANGLE.connect(alice).approve(reactor.address, sharesAmount.mul(100));
      await agEUR.connect(bob).mint(bob.address, parseEther('1000'));
      await reactor.connect(alice).mint(sharesAmount, alice.address);
      const rate = 0.5;
      await oracle.update(parseEther(rate.toString()));
      // In this case, vault cannot be brought in a healthy pos
      // Limit is `healthFactor * liquidationDiscount * surcharge >= collateralFactor`
      await displayVaultState(vaultManager, 1, log, collatBase);
      const discount = Math.max((2 * rate * 0.5) / 1, 0.9);
      const maxStablecoinAmountToRepay = rate * 2 * discount;

      await vaultManager
        .connect(bob)
        ['liquidate(uint256[],uint256[],address,address)'](
          [1],
          [parseEther(maxStablecoinAmountToRepay.toString())],
          bob.address,
          bob.address,
        );
      await displayVaultState(vaultManager, 1, log, collatBase);
      await expect(vaultManager.checkLiquidation(1, bob.address)).to.be.reverted;
      expect(await vaultManager.badDebt()).to.be.gt(0);
      await expect(reactor.connect(alice).withdraw(sharesAmount, alice.address, alice.address)).to.be.reverted;
    });
    it('success - liquidation and withdraw all asset left in the reactor', async () => {
      const sharesAmount = parseUnits('1', collatBase);
      await ANGLE.connect(alice).mint(alice.address, sharesAmount.mul(100));
      await ANGLE.connect(alice).approve(reactor.address, sharesAmount.mul(100));
      await agEUR.connect(bob).mint(bob.address, parseEther('1000'));
      // Shares amount is consumed
      await reactor.connect(alice).mint(sharesAmount, alice.address);
      const rate = 0.5;
      await oracle.update(parseEther(rate.toString()));
      const discount = Math.max((2 * rate * 0.5) / 1, 0.9);
      const maxStablecoinAmountToRepay = rate * 2 * discount;

      await vaultManager
        .connect(bob)
        ['liquidate(uint256[],uint256[],address,address)'](
          [1],
          [parseEther(maxStablecoinAmountToRepay.toString())],
          bob.address,
          bob.address,
        );

      expect(await vaultManager.badDebt()).to.be.gt(0);
      const gains = parseUnits('0.05', collatBase);
      await ANGLE.mint(reactor.address, gains);
      const balancePre = await ANGLE.balanceOf(alice.address);
      await reactor.connect(alice).redeem(sharesAmount, alice.address, alice.address);
      expect(await reactor.claimableRewards()).to.be.equal(0);
      // Null balance because pull function is not yet implemented
      expect(await agEUR.balanceOf(alice.address)).to.be.equal(parseEther('0'));
      expect(await reactor.lastDebt()).to.be.equal(0);
      expect(await ANGLE.balanceOf(alice.address)).to.be.equal(gains.add(balancePre));
    });
  });
});
