import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BigNumber, Signer } from 'ethers';
import { parseEther, parseUnits } from 'ethers/lib/utils';
import hre, { contract, ethers, web3 } from 'hardhat';

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
  Reactor,
  VaultManager,
  VaultManager__factory,
} from '../../typechain';
import { expect } from '../utils/chai-setup';
import { deployUpgradeable, ZERO_ADDRESS } from '../utils/helpers';

contract('Reactor', () => {
  const log = true;

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
  let guardianRole: string;
  let guardianError: string;

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

    guardianRole = web3.utils.keccak256('GUARDIAN_ROLE');
    guardianError = `AccessControl: account ${alice.address.toLowerCase()} is missing role ${guardianRole}`;
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

    oracle = await new MockOracle__factory(deployer).deploy(parseUnits('2', 18), collatBase, treasury.address);

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
    );
    await reactor.connect(guardian).changeAllowance(ethers.constants.MaxUint256);
    await agEUR.connect(bob).approve(eulerMarketA.address, ethers.constants.MaxUint256);
  });
  describe('setMinInvest', () => {
    it('initialize', async () => {
      expect(await reactor.minInvest()).to.be.equal(0);
    });
    it('revert - only guardian or governor', async () => {
      const newMinInvest = parseUnits('1', collatBase);
      await expect(reactor.connect(alice).setMinInvest(newMinInvest)).to.be.revertedWith('2');
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
      expect(await reactor.maxWithdraw(alice.address)).to.be.equal(sharesAmount.mul(2).sub(1));
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
    it('success - when some has been minted and need euler withdraw', async () => {
      await ANGLE.connect(alice).mint(alice.address, sharesAmount);
      await ANGLE.connect(alice).approve(reactor.address, sharesAmount);
      await reactor.connect(alice).mint(sharesAmount, alice.address);
      const gains = parseUnits('1', collatBase);
      await ANGLE.mint(reactor.address, gains);
      expect(await reactor.maxWithdraw(alice.address)).to.be.equal(sharesAmount.mul(2).sub(1));
    });
  });
  describe('Withdraw', () => {
    const sharesAmount = parseUnits('1', collatBase);
    it('success - set interest rate to 0', async () => {
      const balanceAgEUR = await agEUR.balanceOf(alice.address);
      await vaultManager.connect(governor).setUint64(ethers.constants.AddressZero, 'interestRate');
      await ANGLE.connect(alice).mint(alice.address, sharesAmount);
      await ANGLE.connect(alice).approve(reactor.address, sharesAmount);
      await reactor.connect(alice).mint(sharesAmount, alice.address);
      //   await eulerMarketA.connect(bob).setPoolSize(sharesAmount);
      expect(await reactor.maxWithdraw(alice.address)).to.be.equal(sharesAmount.sub(1));
      await reactor.connect(alice).withdraw(await reactor.maxWithdraw(alice.address), alice.address, alice.address);
      expect(await agEUR.balanceOf(alice.address)).to.be.equal(balanceAgEUR);
    });
    it('success - set interest rate to 0', async () => {
      const balanceAgEUR = await agEUR.balanceOf(alice.address);
      await vaultManager.connect(governor).setUint64(ethers.constants.AddressZero, 'interestRate');
      await ANGLE.connect(alice).mint(alice.address, sharesAmount);
      await ANGLE.connect(alice).approve(reactor.address, sharesAmount);
      await reactor.connect(alice).mint(sharesAmount, alice.address);
      //   await eulerMarketA.connect(bob).setPoolSize(sharesAmount);
      expect(await reactor.maxWithdraw(alice.address)).to.be.equal(sharesAmount.sub(1));
      // need to have some return otherwie we can't
      const payForRounding = parseUnits('1', 0);
      await agEUR.connect(bob).mint(reactor.address, payForRounding);
      await reactor.connect(alice).withdraw(await reactor.maxWithdraw(alice.address), alice.address, alice.address);
      expect(await agEUR.balanceOf(alice.address)).to.be.equal(balanceAgEUR);
    });
  });
  //   describe('maxRedeem', () => {
  //     const sharesAmount = parseUnits('1', collatBase);
  //     it('success - when no asset', async () => {
  //       expect(await reactor.maxRedeem(alice.address)).to.be.equal(0);
  //     });
  //     it('success - when some has been minted', async () => {
  //       await ANGLE.connect(alice).mint(alice.address, sharesAmount);
  //       await ANGLE.connect(alice).approve(reactor.address, sharesAmount);
  //       await reactor.connect(alice).mint(sharesAmount, alice.address);
  //       expect(await reactor.maxRedeem(alice.address)).to.be.equal(sharesAmount);
  //     });
  //     it('success - when some has been minted and a gain has been made', async () => {
  //       await ANGLE.connect(alice).mint(alice.address, sharesAmount);
  //       await ANGLE.connect(alice).approve(reactor.address, sharesAmount);
  //       await reactor.connect(alice).mint(sharesAmount, alice.address);
  //       const gains = parseUnits('1', collatBase);
  //       await ANGLE.mint(reactor.address, gains);
  //       // It's still the balance of the user
  //       expect(await reactor.maxRedeem(alice.address)).to.be.equal(sharesAmount);
  //     });
  //   });
});
