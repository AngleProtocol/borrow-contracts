import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { Signer } from 'ethers';
import { formatBytes32String, parseEther, parseUnits } from 'ethers/lib/utils';
import hre, { contract, ethers } from 'hardhat';

import {
  AgToken,
  AgToken__factory,
  EulerReactor,
  EulerReactor__factory,
  MockEulerPool,
  MockEulerPool__factory,
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
} from '../../../typechain';
import { expect } from '../utils/chai-setup';
import { deployUpgradeable, expectApprox, expectApproxDelta, ZERO_ADDRESS } from '../utils/helpers';

const PRECISION = 5;

contract('ReactorEuler', () => {
  let deployer: SignerWithAddress;
  let governor: SignerWithAddress;
  let guardian: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  let reactor: EulerReactor;
  let eulerMarketA: MockEulerPool;
  let treasury: MockTreasury;
  let ANGLE: MockToken;
  let oracle: MockOracle;
  let stableMaster: MockStableMaster;
  let agEUR: AgToken;
  let vaultManager: VaultManager;

  const impersonatedSigners: { [key: string]: Signer } = {};

  const collatBase = 6;
  const yearlyRate = 1.05;
  const ratePerSecond = yearlyRate ** (1 / (365 * 24 * 3600)) - 1;
  const lowerCF = 0.2e9;
  const targetCF = 0.4e9;
  const upperCF = 0.6e9;

  const params = {
    debtCeiling: parseEther('100'),
    collateralFactor: 0.9e9,
    targetHealthFactor: 1.1e9,
    borrowFee: 0e9,
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
    await agEUR.connect(bob).mint(bob.address, parseUnits('10000000', 18));

    oracle = await new MockOracle__factory(deployer).deploy(parseUnits('2', 18), treasury.address);

    stableMaster = await new MockStableMaster__factory(deployer).deploy();

    await vaultManager.initialize(treasury.address, ANGLE.address, oracle.address, params, 'USDC/agEUR');
    await vaultManager.connect(guardian).togglePause();

    eulerMarketA = await new MockEulerPool__factory(deployer).deploy(agEUR.address, parseUnits('0', 18));
    reactor = (await deployUpgradeable(new EulerReactor__factory(deployer))) as EulerReactor;
    await reactor.initialize(
      eulerMarketA.address,
      ethers.constants.Zero,
      'ANGLE/agEUR Reactor',
      'ANGLE/agEUR Reactor',
      vaultManager.address,
      lowerCF,
      targetCF,
      upperCF,
      0,
    );
    // await reactor.connect(guardian).changeAllowance(ethers.constants.MaxUint256);
    await agEUR.connect(bob).approve(eulerMarketA.address, ethers.constants.MaxUint256);
  });
  describe('setMinInvest', () => {
    it('initialize', async () => {
      expect(await reactor.minInvest()).to.be.equal(0);
    });
    it('reverts - only guardian or governor', async () => {
      const newMinInvest = parseUnits('1', collatBase);
      await expect(reactor.connect(alice).setMinInvest(newMinInvest)).to.be.revertedWith('NotGovernorOrGuardian');
    });
    it('success - invest only at 1 unit', async () => {
      const newMinInvest = parseUnits('1', collatBase);
      await reactor.connect(guardian).setMinInvest(newMinInvest);
      expect(await reactor.minInvest()).to.be.equal(newMinInvest);
    });
    it('success - invest at all thres', async () => {
      const newMinInvest = parseUnits('0', collatBase);
      await reactor.connect(governor).setMinInvest(newMinInvest);
      expect(await reactor.minInvest()).to.be.equal(newMinInvest);
    });
  });
  describe('changeAllowance', () => {
    it('reverts - only guardian or governor', async () => {
      await expect(reactor.connect(alice).changeAllowance(ethers.constants.Zero)).to.be.revertedWith(
        'NotGovernorOrGuardian',
      );
    });
    it('success - decrease allowance', async () => {
      await reactor.connect(guardian).changeAllowance(ethers.constants.Zero);
      expect(await agEUR.allowance(reactor.address, eulerMarketA.address)).to.be.equal(parseEther('0'));
    });
    it('success - allowance modified', async () => {
      await reactor.connect(guardian).changeAllowance(ethers.constants.MaxUint256);
      expect(await agEUR.allowance(reactor.address, eulerMarketA.address)).to.be.equal(ethers.constants.MaxUint256);
    });
    it('success - increase allowance', async () => {
      await reactor.connect(guardian).changeAllowance(ethers.constants.Zero);
      expect(await agEUR.allowance(reactor.address, eulerMarketA.address)).to.be.equal(parseEther('0'));
      await reactor.connect(guardian).changeAllowance(ethers.constants.MaxUint256);
      expect(await agEUR.allowance(reactor.address, eulerMarketA.address)).to.be.equal(ethers.constants.MaxUint256);
    });
  });
  describe('maxDeposit', () => {
    beforeEach(async () => {
      await vaultManager.connect(governor).setDebtCeiling(ethers.constants.MaxUint256.div(parseUnits('1', 27)));
    });
    it('success - debtCeiling and max sane amount on Euler are infinite', async () => {
      expect(await reactor.maxDeposit(alice.address)).to.be.equal(ethers.constants.MaxUint256);
    });
    it('success - debtCeiling is infinite but max sane amount on Euler is not infinite', async () => {
      await eulerMarketA.setMAXSANEAMOUNT(parseUnits('100', 18));
      expect(await reactor.maxDeposit(alice.address)).to.be.equal(parseUnits('125', collatBase));
    });
    it('success - debtCeiling is not infinite but max sane amount on Euler is infinite', async () => {
      await vaultManager.connect(governor).setDebtCeiling(parseUnits('100', 18));
      expect(await reactor.maxDeposit(alice.address)).to.be.equal(parseUnits('125', collatBase));
    });
    it('success - debtCeiling < max sane amount - not infinite', async () => {
      await eulerMarketA.setMAXSANEAMOUNT(parseUnits('100', 18));
      await vaultManager.connect(governor).setDebtCeiling(parseUnits('50', 18));
      expect(await reactor.maxDeposit(alice.address)).to.be.equal(parseUnits('62.5', collatBase));
    });
    it('success - debtCeiling > max sane amount - not infinite', async () => {
      await eulerMarketA.setMAXSANEAMOUNT(parseUnits('50', 18));
      await vaultManager.connect(governor).setDebtCeiling(parseUnits('100', 18));
      expect(await reactor.maxDeposit(alice.address)).to.be.equal(parseUnits('62.5', collatBase));
    });
    it('success - super low max sane amount - but no borrow triggered ', async () => {
      const sharesAmount = parseUnits('100', collatBase);
      await ANGLE.connect(alice).mint(alice.address, sharesAmount);
      await ANGLE.connect(alice).approve(reactor.address, sharesAmount);
      await reactor.connect(alice).mint(sharesAmount, alice.address);
      await eulerMarketA.setMAXSANEAMOUNT(parseUnits('0.0001', 18));
      expect(await reactor.maxDeposit(alice.address)).to.be.equal(parseUnits('100', collatBase));
    });
  });
  describe('maxMint', () => {
    it('success', async () => {
      await eulerMarketA.setMAXSANEAMOUNT(parseUnits('50', 18));
      await vaultManager.connect(governor).setDebtCeiling(parseUnits('100', 18));
      expect(await reactor.maxMint(alice.address)).to.be.equal(parseUnits('62.5', collatBase));
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
      //   await eulerMarketA.connect(bob).setPoolSize(sharesAmount);
      expect(await reactor.maxWithdraw(alice.address)).to.be.equal(sharesAmount.sub(1));
      // attention here you can't withdraw all if the interest rate from borrow is > 0 and we didn't do any profit on Euler
      // because you can't repay the debt
    });
    it('success - when no liquidity on Euler', async () => {
      await ANGLE.connect(alice).mint(alice.address, sharesAmount);
      await ANGLE.connect(alice).approve(reactor.address, sharesAmount);
      await reactor.connect(alice).mint(sharesAmount, alice.address);
      await eulerMarketA.connect(bob).setPoolSize(ethers.constants.Zero);
      expect(await reactor.maxWithdraw(alice.address)).to.be.equal(ethers.constants.Zero);
    });
    it('success - when some has been minted and no need to withdraw from Euler', async () => {
      await ANGLE.connect(alice).mint(alice.address, sharesAmount);
      await ANGLE.connect(alice).approve(reactor.address, sharesAmount);
      await reactor.connect(alice).mint(sharesAmount, alice.address);
      const gains = parseUnits('1', collatBase);
      await ANGLE.connect(bob).mint(reactor.address, gains);
      expect(await reactor.maxWithdraw(alice.address)).to.be.equal(sharesAmount.mul(2));
    });
    it('success - when some has been minted and no need to withdraw from Euler', async () => {
      await ANGLE.connect(alice).mint(alice.address, sharesAmount);
      await ANGLE.connect(alice).approve(reactor.address, sharesAmount);
      await ANGLE.connect(bob).mint(bob.address, sharesAmount);
      await ANGLE.connect(bob).approve(reactor.address, sharesAmount);
      await reactor.connect(alice).mint(sharesAmount, alice.address);
      await reactor.connect(bob).mint(sharesAmount, bob.address);
      // this will have only a marginal impact on the maxWithdraw function
      // it only allows to correct rounding errors which is why it is equal to sharesAmount
      const gains = parseUnits('1', 18);
      await agEUR.connect(bob).mint(reactor.address, gains);
      expect(await reactor.maxWithdraw(alice.address)).to.be.equal(sharesAmount);
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
      expect(await reactor.maxRedeem(alice.address)).to.be.equal(sharesAmount.sub(1));
    });
  });
  describe('withdraw', () => {
    const sharesAmount = parseUnits('1', collatBase);
    it('success - set interest rate to 0', async () => {
      const balanceAgEUR = await agEUR.balanceOf(alice.address);
      await vaultManager.connect(governor).setUint64(ethers.constants.AddressZero, formatBytes32String('IR'));
      await ANGLE.connect(alice).mint(alice.address, sharesAmount);
      await ANGLE.connect(alice).approve(reactor.address, sharesAmount);
      await reactor.connect(alice).mint(sharesAmount, alice.address);
      const amountInvestedInEuler = await eulerMarketA.balanceOfUnderlying(reactor.address);
      expect(amountInvestedInEuler).to.be.equal(parseUnits('0.8', 18).sub(1));
      expect(await reactor.maxWithdraw(alice.address)).to.be.equal(sharesAmount.sub(1));
      await reactor.connect(alice).withdraw(await reactor.maxWithdraw(alice.address), alice.address, alice.address);
      expect(await agEUR.balanceOf(alice.address)).to.be.equal(balanceAgEUR);
    });
    it('success - under minInvest', async () => {
      const newMinInvest = parseUnits('1', 18);
      await reactor.connect(guardian).setMinInvest(newMinInvest);

      await ANGLE.connect(alice).mint(alice.address, sharesAmount);
      await ANGLE.connect(alice).approve(reactor.address, sharesAmount);
      await reactor.connect(alice).mint(sharesAmount, alice.address);

      const amountInvestedInEuler = await eulerMarketA.balanceOfUnderlying(reactor.address);
      const lastBalance = await reactor.lastBalance();
      const vaultDebt = await vaultManager.getVaultDebt(1);
      expect(amountInvestedInEuler).to.be.equal(ethers.constants.Zero);
      expect(lastBalance).to.be.equal(parseUnits('0.8', 18).sub(1));
      expectApproxDelta(vaultDebt, parseUnits('0.8', 18), parseUnits('1', PRECISION));
    });
    it('success - no need to withdraw from Euler', async () => {
      const sharesAmountBob = parseUnits('10', collatBase);
      await vaultManager.connect(governor).setUint64(ethers.constants.AddressZero, formatBytes32String('IR'));
      await ANGLE.connect(alice).mint(alice.address, sharesAmount);
      await ANGLE.connect(alice).approve(reactor.address, sharesAmount);
      await reactor.connect(alice).mint(sharesAmount, alice.address);
      await ANGLE.connect(bob).mint(bob.address, sharesAmountBob);
      await ANGLE.connect(bob).approve(reactor.address, sharesAmountBob);
      await reactor.connect(bob).deposit(sharesAmountBob, bob.address);
      let lastBalance = await reactor.lastBalance();
      expect(lastBalance).to.be.equal(parseUnits('8.8', 18).sub(1));
      const gains = parseUnits('1', 18);
      await agEUR.connect(bob).mint(reactor.address, gains);
      // to trigger lastBalance
      await reactor.connect(alice).claim(alice.address);
      await reactor.connect(alice).withdraw(await reactor.maxWithdraw(alice.address), alice.address, alice.address);
      const amountInvestedInEuler = await eulerMarketA.balanceOfUnderlying(reactor.address);
      lastBalance = await reactor.lastBalance();
      expectApprox(amountInvestedInEuler, parseUnits('8.8', 18).sub(1), 0.1);
    });
    it('success - over the upperCF but poolSize too small', async () => {
      const balanceAgEUR = await agEUR.balanceOf(alice.address);
      await vaultManager.connect(governor).setUint64(ethers.constants.AddressZero, formatBytes32String('IR'));
      await ANGLE.connect(alice).mint(alice.address, sharesAmount);
      await ANGLE.connect(alice).approve(reactor.address, sharesAmount);
      await reactor.connect(alice).mint(sharesAmount, alice.address);
      await eulerMarketA.connect(bob).setPoolSize(parseUnits('0.4', 18));
      expect(await reactor.maxWithdraw(alice.address)).to.be.equal(sharesAmount.div(2));
      await reactor.connect(alice).withdraw(await reactor.maxWithdraw(alice.address), alice.address, alice.address);
      expect(await agEUR.balanceOf(alice.address)).to.be.equal(balanceAgEUR);
      expect(await ANGLE.balanceOf(alice.address)).to.be.equal(sharesAmount.div(2));
      expect(await reactor.balanceOf(alice.address)).to.be.equal(sharesAmount.div(2));
    });
    it('success - withdraw under the upperCF', async () => {
      const sharesAmountBob = parseUnits('10', collatBase);
      const balanceAgEUR = await agEUR.balanceOf(alice.address);
      await vaultManager.connect(governor).setUint64(ethers.constants.AddressZero, formatBytes32String('IR'));
      await ANGLE.connect(alice).mint(alice.address, sharesAmount);
      await ANGLE.connect(alice).approve(reactor.address, sharesAmount);
      await reactor.connect(alice).mint(sharesAmount, alice.address);
      await ANGLE.connect(bob).mint(bob.address, sharesAmountBob);
      await ANGLE.connect(bob).approve(reactor.address, sharesAmountBob);
      await reactor.connect(bob).deposit(sharesAmountBob, bob.address);
      expect(await reactor.maxWithdraw(alice.address)).to.be.equal(sharesAmount);
      await reactor.connect(alice).withdraw(await reactor.maxWithdraw(alice.address), alice.address, alice.address);
      expect(await agEUR.balanceOf(alice.address)).to.be.equal(balanceAgEUR);
      expect(await ANGLE.balanceOf(alice.address)).to.be.equal(sharesAmount);
    });
    it('success - over the upperCF but not reaching the dust', async () => {
      const sharesAmountBob = parseUnits('0.2', collatBase);
      const balanceAgEUR = await agEUR.balanceOf(alice.address);
      await vaultManager.connect(governor).setUint64(ethers.constants.AddressZero, formatBytes32String('IR'));
      await ANGLE.connect(alice).mint(alice.address, sharesAmount);
      await ANGLE.connect(alice).approve(reactor.address, sharesAmount);
      await reactor.connect(alice).mint(sharesAmount, alice.address);
      await ANGLE.connect(bob).mint(bob.address, sharesAmountBob);
      await ANGLE.connect(bob).approve(reactor.address, sharesAmountBob);
      await reactor.connect(bob).deposit(sharesAmountBob, bob.address);
      expect(await reactor.maxWithdraw(alice.address)).to.be.equal(sharesAmount);
      await reactor.connect(alice).withdraw(await reactor.maxWithdraw(alice.address), alice.address, alice.address);
      expect(await agEUR.balanceOf(alice.address)).to.be.equal(balanceAgEUR);
      expect(await ANGLE.balanceOf(alice.address)).to.be.equal(sharesAmount);
    });
    it('reverts - non null interest rate VaultManager and no profits', async () => {
      await ANGLE.connect(alice).mint(alice.address, sharesAmount);
      await ANGLE.connect(alice).approve(reactor.address, sharesAmount);
      await reactor.connect(alice).mint(sharesAmount, alice.address);
      expect(await reactor.maxWithdraw(alice.address)).to.be.equal(sharesAmount.sub(1));
      await expect(
        reactor.connect(alice).withdraw(await reactor.maxWithdraw(alice.address), alice.address, alice.address),
      ).to.be.revertedWith('ERC20: burn amount exceeds balance');
    });
    it('success - overall profit', async () => {
      const balanceAgEUR = await agEUR.balanceOf(alice.address);
      await ANGLE.connect(alice).mint(alice.address, sharesAmount);
      await ANGLE.connect(alice).approve(reactor.address, sharesAmount);
      await reactor.connect(alice).mint(sharesAmount, alice.address);
      // fake a profit on Euler markets
      await eulerMarketA.connect(bob).setInterestRateAccumulator(parseUnits('2', 18));
      await eulerMarketA.connect(bob).setPoolSize(parseUnits('1.6', 18));
      expect(await reactor.maxWithdraw(alice.address)).to.be.equal(sharesAmount);
      const vaultDebt = await vaultManager.getVaultDebt(1);
      await reactor.connect(alice).withdraw(await reactor.maxWithdraw(alice.address), alice.address, alice.address);
      // sub(2) because we have the interest rate x2 but the actual deposit was 0.79999...
      const approxProfit = parseUnits('1.6', 18).sub(2).sub(vaultDebt);
      expectApproxDelta(
        await agEUR.balanceOf(alice.address),
        balanceAgEUR.add(approxProfit),
        parseUnits('1', PRECISION),
      );
    });
    it('success - loss also on Euler', async () => {
      await ANGLE.connect(alice).mint(alice.address, sharesAmount);
      await ANGLE.connect(alice).approve(reactor.address, sharesAmount);
      await reactor.connect(alice).mint(sharesAmount, alice.address);
      // fake a loss on Euler markets
      await eulerMarketA.connect(bob).setInterestRateAccumulator(parseUnits('0.5', 18));
      await eulerMarketA.connect(bob).setPoolSize(parseUnits('0.4', 18));
      expect(await reactor.maxWithdraw(alice.address)).to.be.equal(sharesAmount.div(2).sub(1));
      const vaultDebt = await vaultManager.getVaultDebt(1);
      await reactor.connect(alice).withdraw(await reactor.maxWithdraw(alice.address), alice.address, alice.address);
      const loss = parseUnits('0.4', 18).add(vaultDebt.sub(parseUnits('0.8', 18)));
      expectApproxDelta(await reactor.connect(alice).currentLoss(), loss, parseUnits('1', PRECISION));
    });
    it('success - profit with a non null protocol interest share', async () => {
      await vaultManager.connect(governor).setUint64(ethers.constants.AddressZero, formatBytes32String('IR'));
      await ANGLE.connect(alice).mint(alice.address, sharesAmount);
      await ANGLE.connect(alice).approve(reactor.address, sharesAmount);
      await reactor.connect(alice).mint(sharesAmount, alice.address);
      // fake a gain on Euler markets
      await eulerMarketA.connect(bob).setInterestRateAccumulator(parseUnits('2', 18));
      await agEUR.connect(bob).mint(eulerMarketA.address, parseUnits('100', 18));
      const vaultDebt = await vaultManager.getVaultDebt(1);
      await reactor.connect(governor).setUint64(0.5e9, formatBytes32String('protocolInterestShare'));
      await reactor.connect(alice).redeem(sharesAmount, alice.address, alice.address);
      expect(await agEUR.balanceOf(alice.address)).to.be.equal(vaultDebt.div(2).add(1));
      expect(await reactor.protocolInterestAccumulated()).to.be.equal(vaultDebt.div(2));
    });
    it('success - loss with a non null protocol interest share', async () => {
      await vaultManager.connect(governor).setUint64(ethers.constants.AddressZero, formatBytes32String('IR'));
      await ANGLE.connect(alice).mint(alice.address, sharesAmount);
      await ANGLE.connect(alice).approve(reactor.address, sharesAmount);
      await reactor.connect(alice).mint(sharesAmount, alice.address);
      // fake a loss on Euler markets
      await eulerMarketA.connect(bob).setInterestRateAccumulator(parseUnits('0.5', 18));
      await agEUR.connect(bob).mint(eulerMarketA.address, parseUnits('100', 18));
      const vaultDebt = await vaultManager.getVaultDebt(1);
      await reactor.connect(governor).setUint64(0.5e9, formatBytes32String('protocolInterestShare'));
      await reactor.connect(alice).withdraw(await reactor.maxWithdraw(alice.address), alice.address, alice.address);
      // You can only withdraw half of what you had in this case
      expect(await agEUR.balanceOf(alice.address)).to.be.equal(0);
      expect(await reactor.protocolDebt()).to.be.equal(vaultDebt.div(4).add(1));
      expect(await reactor.currentLoss()).to.be.equal(vaultDebt.div(4).add(1));
    });

    it('success - profit with a non null protocol interest share and a small loss already accumulated', async () => {
      await vaultManager.connect(governor).setUint64(ethers.constants.AddressZero, formatBytes32String('IR'));
      await ANGLE.connect(alice).mint(alice.address, sharesAmount);
      await ANGLE.connect(alice).approve(reactor.address, sharesAmount);
      await reactor.connect(alice).mint(sharesAmount, alice.address);
      // fake a loss on Euler markets
      await eulerMarketA.connect(bob).setInterestRateAccumulator(parseUnits('0.5', 18));
      await agEUR.connect(bob).mint(eulerMarketA.address, parseUnits('100', 18));
      const vaultDebt = await vaultManager.getVaultDebt(1);
      await reactor.connect(governor).setUint64(0.5e9, formatBytes32String('protocolInterestShare'));

      await reactor.connect(alice).withdraw(await reactor.maxWithdraw(alice.address), alice.address, alice.address);
      // You can only withdraw half of what you had in this case
      expect(await agEUR.balanceOf(alice.address)).to.be.equal(0);
      expect(await reactor.protocolDebt()).to.be.equal(vaultDebt.div(4).add(1));
      expect(await reactor.currentLoss()).to.be.equal(vaultDebt.div(4).add(1));
      expect(await reactor.protocolInterestAccumulated()).to.be.equal(0);
      // Only dust is left in the protocol
      // Alice has 0.5 shares now -> minting so that she has 1.5
      await ANGLE.connect(alice).mint(alice.address, sharesAmount);
      await ANGLE.connect(alice).approve(reactor.address, sharesAmount);
      await reactor.connect(alice).mint(sharesAmount, alice.address);
      // fake a gain on Euler markets
      await eulerMarketA.connect(bob).setInterestRateAccumulator(parseUnits('2', 18));
      await reactor.connect(alice).redeem(sharesAmount, alice.address, alice.address);
      expect(await reactor.currentLoss()).to.be.equal(0);
      // Previous loss was 0.2 -> and there are still 0.8 stablecoins out there, so 3.2 after gain is realized -> new gain
      // is hence 2.4 which divided by 2 makes a protocol gain of 1.2 to offset the loss of 0.2 -> so it's 1 eventually
      expectApprox(await reactor.protocolInterestAccumulated(), parseEther('1'), 0.1);
      expectApprox(await agEUR.balanceOf(alice.address), parseEther('1'), 0.1);
    });

    it('success - profit with a non null protocol interest share and a big loss already accumulated', async () => {
      await vaultManager.connect(governor).setUint64(ethers.constants.AddressZero, formatBytes32String('IR'));
      await ANGLE.connect(alice).mint(alice.address, sharesAmount);
      await ANGLE.connect(alice).approve(reactor.address, sharesAmount);
      await reactor.connect(alice).mint(sharesAmount, alice.address);
      // fake a loss on Euler markets
      await eulerMarketA.connect(bob).setInterestRateAccumulator(parseUnits('0.5', 18));
      await agEUR.connect(bob).mint(eulerMarketA.address, parseUnits('100', 18));
      const vaultDebt = await vaultManager.getVaultDebt(1);
      await reactor.connect(governor).setUint64(0.5e9, formatBytes32String('protocolInterestShare'));

      await reactor.connect(alice).withdraw(await reactor.maxWithdraw(alice.address), alice.address, alice.address);
      // You can only withdraw half of what you had in this case
      expect(await agEUR.balanceOf(alice.address)).to.be.equal(0);
      expect(await reactor.protocolDebt()).to.be.equal(vaultDebt.div(4).add(1));
      expect(await reactor.currentLoss()).to.be.equal(vaultDebt.div(4).add(1));
      expect(await reactor.protocolInterestAccumulated()).to.be.equal(0);
      // Only dust is left in the protocol
      // Alice has 0.5 shares now -> minting so that she has 1.5
      await ANGLE.connect(alice).mint(alice.address, sharesAmount);
      await ANGLE.connect(alice).approve(reactor.address, sharesAmount);
      await reactor.connect(alice).mint(sharesAmount, alice.address);
      // fake a gain on Euler markets
      await eulerMarketA.connect(bob).setInterestRateAccumulator(parseUnits('0.6', 18));
      await reactor.connect(alice).redeem(sharesAmount, alice.address, alice.address);
      // Previous loss was 0.2 -> and there are still 0.8 stablecoins out there, so 0.96 after gain is realized -> new gain
      // is hence 0.18 which divided by 2 makes a protocol gain of 0.09 to offset the loss of 0.2
      expect(await reactor.protocolInterestAccumulated()).to.be.equal(0);
      expect(await agEUR.balanceOf(alice.address)).to.be.equal(0);
      expectApprox(await reactor.protocolDebt(), parseEther('0.12'), 0.01);
      expectApprox(await reactor.currentLoss(), parseEther('0.12'), 0.01);
    });

    it('success - small loss after a big profit with a non null protocol interest share', async () => {
      await vaultManager.connect(governor).setUint64(ethers.constants.AddressZero, formatBytes32String('IR'));
      await ANGLE.connect(alice).mint(alice.address, sharesAmount);
      await ANGLE.connect(alice).approve(reactor.address, sharesAmount);
      await reactor.connect(alice).mint(sharesAmount, alice.address);
      // fake a gain on Euler markets
      await eulerMarketA.connect(bob).setInterestRateAccumulator(parseUnits('2', 18));
      await agEUR.connect(bob).mint(eulerMarketA.address, parseUnits('100', 18));
      const vaultDebt = await vaultManager.getVaultDebt(1);
      await reactor.connect(governor).setUint64(0.5e9, formatBytes32String('protocolInterestShare'));
      await reactor.connect(alice).redeem(sharesAmount, alice.address, alice.address);
      expect(await agEUR.balanceOf(alice.address)).to.be.equal(vaultDebt.div(2).add(1));
      // Gain is 0.4
      expect(await reactor.protocolInterestAccumulated()).to.be.equal(vaultDebt.div(2));
      await ANGLE.connect(alice).mint(alice.address, sharesAmount);
      await ANGLE.connect(alice).approve(reactor.address, sharesAmount);
      await reactor.connect(alice).mint(sharesAmount, alice.address);
      await eulerMarketA.connect(bob).setInterestRateAccumulator(parseUnits('1.5', 18));
      // Here there are 1.2 stablecoins and a loss of 0.3 on it -> so 0.15 less
      await reactor.connect(alice).redeem(sharesAmount.div(2), alice.address, alice.address);
      expect(await reactor.protocolInterestAccumulated()).to.be.equal(vaultDebt.div(2).sub(parseEther('0.15')));
      expectApprox(await reactor.currentLoss(), parseEther('0.15'), 0.001);
    });
  });
});
