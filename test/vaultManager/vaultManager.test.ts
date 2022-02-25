import { Oracle, Oracle__factory } from '@angleprotocol/sdk/dist/constants/types';
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
import {
  addCollateral,
  angle,
  borrow,
  createVault,
  deployUpgradeable,
  displayVaultState,
  expectApprox,
  increaseTime,
  ZERO_ADDRESS,
} from '../utils/helpers';

contract('VaultManager', () => {
  const log = true;

  let deployer: SignerWithAddress;
  let governor: SignerWithAddress;
  let guardian: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  let treasury: MockTreasury;
  let collateral: MockToken;
  let oracle: MockOracle;
  let stableMaster: MockStableMaster;
  let agToken: AgToken;
  let vaultManager: VaultManager;

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

  describe.skip('oracle', () => {
    it('success - read', async () => {
      const oracle = (await ethers.getContractAt(Oracle__factory.abi, await vaultManager.oracle())) as Oracle;
      expect(await oracle.read()).to.be.equal(parseUnits('2', 18));
    });
  });

  describe.skip('createVault', () => {
    it('revert - paused', async () => {
      await vaultManager.connect(guardian).togglePause();
      await expect(vaultManager.createVault(alice.address)).to.be.revertedWith('42');
    });

    it('success', async () => {
      await vaultManager.createVault(alice.address);
      expect(await vaultManager.ownerOf(1)).to.be.equal(alice.address);
      expect(await vaultManager.balanceOf(alice.address)).to.be.equal(1);
    });
  });

  describe.skip('angle', () => {
    it('revert - paused', async () => {
      await vaultManager.connect(guardian).togglePause();
      await expect(angle(vaultManager, alice, [createVault(alice.address)])).to.be.revertedWith('42');
    });

    it('success - state', async () => {
      await angle(vaultManager, alice, [createVault(alice.address), createVault(alice.address)]);
      expect(await vaultManager.balanceOf(alice.address)).to.be.equal(2);
      expect(await vaultManager.ownerOf(1)).to.be.equal(alice.address);
      expect(await vaultManager.ownerOf(2)).to.be.equal(alice.address);
    });

    it('revert - not whitelisted', async () => {
      await vaultManager.connect(governor).toggleWhitelisting();
      await expect(angle(vaultManager, alice, [createVault(alice.address)])).to.be.revertedWith('20');
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

  describe.skip('addCollateral', () => {
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
    });
  });

  describe.skip('borrow', () => {
    it('revert - limit CF', async () => {
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

    it('success', async () => {
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
      await expect(vaultManager.checkLiquidation(2, alice.address)).to.be.revertedWith('44');
    });
  });

  describe.skip('discount', () => {
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

      // Health factor should be
      // `collateralAmountInStable * collateralFactor) / currentDebt`
      expect((await vaultManager.checkLiquidation(2, bob.address)).discount).to.be.equal(
        1e9 - params.maxLiquidationDiscount,
      );
    });

    it('success - modified max discount', async () => {
      await vaultManager.connect(governor).setUint64(0.5e9, formatBytes32String('maxLiquidationDiscount'));
      await oracle.update(parseEther('0.1'));

      // Health factor should be
      // `collateralAmountInStable * collateralFactor) / currentDebt`
      expect((await vaultManager.checkLiquidation(2, bob.address)).discount).to.be.equal(1e9 - 0.5e9);
    });

    it('success - modified base boost', async () => {
      await vaultManager.connect(governor).setLiquidationBoostParameters(ZERO_ADDRESS, [], [0.5e9]);
      await oracle.update(parseEther('0.9'));

      // Health factor should be
      // `collateralAmountInStable * collateralFactor) / currentDebt`
      expect((await vaultManager.checkLiquidation(2, bob.address)).discount).to.be.equal(
        (1 - (1 - 2 * 0.9 * 0.5) * 0.5) * 1e9,
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

    it('success', async () => {
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

    it('success - case 2', async () => {
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
          [parseEther(maxStablecoinAmountToRepay.toString())],
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

      console.log('Rate per year is: ', (1 + ratePerSecond) ** (365 * 24 * 3600));
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
});
