import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BigNumber, Signer } from 'ethers';
import { parseEther, parseUnits } from 'ethers/lib/utils';
import hre, { contract, ethers } from 'hardhat';

import {
  MockAgToken,
  MockAgToken__factory,
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
import { inReceipt } from '../utils/expectEvent';
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
  latestTime,
  repayDebt,
  ZERO_ADDRESS,
} from '../utils/helpers';

contract('VaultManager - Dust Modification interactions', () => {
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
  let agToken: MockAgToken;
  let vaultManager: VaultManager;

  const impersonatedSigners: { [key: string]: Signer } = {};

  const collatBase = 10;
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

    agToken = (await deployUpgradeable(new MockAgToken__factory(deployer))) as MockAgToken;
    await agToken.connect(deployer).initialize('agEUR', 'agEUR', stableMaster.address);

    collateral = await new MockToken__factory(deployer).deploy('A', 'A', collatBase);

    vaultManager = (await deployUpgradeable(new VaultManager__factory(deployer))) as VaultManager;

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
      await expect(vaultManager.connect(alice).setDusts(0, 0, 0)).to.be.revertedWith('NotGovernor');
      await expect(vaultManager.connect(guardian).setDusts(0, 0, 0)).to.be.revertedWith('NotGovernor');
    });
    it('success - when governor is calling', async () => {
      await vaultManager.connect(governor).setDusts(1, 2, 1);
      expect(await vaultManager.dust()).to.be.equal(1);
      expect(await vaultManager.dustLiquidation()).to.be.equal(2);
      await vaultManager.connect(governor).setDusts(parseEther('0.1'), parseEther('10'), 1);
      expect(await vaultManager.dust()).to.be.equal(parseEther('0.1'));
      expect(await vaultManager.dustLiquidation()).to.be.equal(parseEther('10'));
    });
    it('reverts - invalid parameter value', async () => {
      await expect(vaultManager.connect(governor).setDusts(2, 1, 1)).to.be.revertedWith('InvalidParameterValue');
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
      await vaultManager.connect(governor).setDusts(parseEther('1'), parseEther('1'), parseEther('1'));
      await expect(angle(vaultManager, alice, [repayDebt(2, parseEther('0.3'))])).to.be.revertedWith(
        'DustyLeftoverAmount',
      );
      await vaultManager.connect(governor).setDusts(parseEther('0.1'), parseEther('0.1'), parseEther('0.1'));
      await angle(vaultManager, alice, [repayDebt(2, parseEther('0.3'))]);
      expect((await vaultManager.vaultData(2)).collateralAmount).to.be.equal(collatAmount);
      expect((await vaultManager.vaultData(2)).normalizedDebt).to.be.equal(parseEther('0.2'));
      expect(await vaultManager.lastInterestAccumulatorUpdated()).to.be.equal(await latestTime());
      expect(await vaultManager.getVaultDebt(2)).to.be.equal(parseEther('0.2'));
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('0.2'));
      await vaultManager.connect(governor).setDusts(parseEther('1'), parseEther('1'), parseEther('1'));
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
      const borrowAmount = parseEther('2');
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
      expect(await vaultManager.getVaultDebt(2)).to.be.equal(parseEther('2'));
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
      expect(await vaultManager.getVaultDebt(2)).to.be.equal(parseEther('1'));
      expect(await vaultManager.getVaultDebt(1)).to.be.equal(parseEther('1'));
      await vaultManager.connect(governor).setDusts(parseEther('0.5'), parseEther('0.5'), parseEther('0.5'));
      await expect(
        angle(vaultManager, alice, [getDebtIn(1, vaultManager.address, 2, parseEther('0.6'))]),
      ).to.be.revertedWith('DustyLeftoverAmount');
      await vaultManager.connect(governor).setDusts(parseEther('1.5'), parseEther('1.5'), parseEther('1.5'));
      // You cannot reduce your debt
      await expect(
        angle(vaultManager, alice, [getDebtIn(1, vaultManager.address, 2, parseEther('0.1'))]),
      ).to.be.revertedWith('DustyLeftoverAmount');
    });
  });

  describe('checkLiquidation - with dust variations and cases', () => {
    it('success - dust collateral amount', async () => {
      const collatAmount = parseUnits('2', collatBase);
      const borrowAmount = parseEther('1');

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
      const rate = 0.01;
      await oracle.update(parseEther(rate.toString()));

      // In this case, vault cannot be brought in a healthy pos
      // Limit is `healthFactor * liquidationDiscount * surcharge >= collateralFactor`

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
      // Now if dust increases, we may be in a situation where it's too high
      await displayVaultState(vaultManager, 2, log, collatBase);
      await vaultManager.connect(governor).setDusts(parseEther('10'), parseEther('10'), parseEther('10'));
      const stableAmountToRepay = (await vaultManager.checkLiquidation(2, bob.address)).maxStablecoinAmountToRepay;
      const collatGiven = (await vaultManager.checkLiquidation(2, bob.address)).maxCollateralAmountGiven;
      expectApprox(stableAmountToRepay, parseEther(maxStablecoinAmountToRepay.toString()), 0.0001);
      expect((await vaultManager.checkLiquidation(2, bob.address)).thresholdRepayAmount).to.be.equal(1);
      expectApprox(collatGiven, collatAmount, 0.0001);
      // Now if I liquidate with bob
      const bobStablecoinBalance = await agToken.balanceOf(bob.address);
      const bobCollatBalance = await collateral.balanceOf(bob.address);
      await displayVaultState(vaultManager, 2, log, collatBase);
      await vaultManager.connect(bob)[
        // We're bringing minimum amount to repay
        'liquidate(uint256[],uint256[],address,address)'
      ]([2], [3], bob.address, bob.address);
      expect(await agToken.balanceOf(bob.address)).to.be.equal(bobStablecoinBalance.sub(stableAmountToRepay));
      expect(await collateral.balanceOf(bob.address)).to.be.equal(bobCollatBalance.add(collatGiven));
      expectApprox(await vaultManager.badDebt(), parseEther('0.9838'), 0.1);

      await expect(vaultManager.checkLiquidation(2, bob.address)).to.be.reverted;
      expect(await vaultManager.totalNormalizedDebt()).to.be.equal(0);
    });
    it('success - dust on the debt', async () => {
      const collatAmount = parseUnits('2', collatBase);
      const borrowAmount = parseEther('1');

      // Collat amount in stable should be 4
      // So max borrowable amount is 2
      await collateral.connect(alice).mint(alice.address, collatAmount);
      await collateral.connect(alice).approve(vaultManager.address, collatAmount);

      await stableMaster.connect(bob).mint(agToken.address, bob.address, borrowAmount.mul(10));
      await agToken.connect(bob).approve(vaultManager.address, borrowAmount);

      await angle(vaultManager, alice, [
        createVault(alice.address),
        createVault(alice.address),
        addCollateral(2, collatAmount),
        borrow(2, borrowAmount),
      ]);
      const rate = 0.6;
      await oracle.update(parseEther(rate.toString()));

      // This time discount is maxed
      const discount = Math.max((2 * rate * 0.8) / 1, 0.9);
      const maxStablecoinAmountToRepay = (1.1 - rate * 2 * 0.8) / (0.9 * 1.1 - 0.8 / discount);

      await displayVaultState(vaultManager, 2, log, collatBase);

      // This is approx equal to 0.89 over 1
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
      expect((await vaultManager.checkLiquidation(2, bob.address)).thresholdRepayAmount).to.be.equal(0);

      await vaultManager.connect(governor).setDusts(parseEther('0.5'), parseEther('0.5'), parseEther('0.5'));

      await displayVaultState(vaultManager, 2, log, collatBase);

      // Now if dust increases such that repaying the debt places the address under dust:

      console.log((await vaultManager.checkLiquidation(2, bob.address)).maxStablecoinAmountToRepay.toString());

      const maxStablecoinAmountToRepay2 = 1 / 0.9;

      expectApprox(
        (await vaultManager.checkLiquidation(2, bob.address)).maxStablecoinAmountToRepay,
        parseEther(maxStablecoinAmountToRepay2.toString()),
        0.0001,
      );
      expectApprox(
        (await vaultManager.checkLiquidation(2, bob.address)).maxCollateralAmountGiven,
        parseUnits((maxStablecoinAmountToRepay2 / rate / discount).toFixed(10), collatBase),
        0.0001,
      );
      // Threshold repay amount is (debt - dust) / surcharge
      expectApprox(
        (await vaultManager.checkLiquidation(2, bob.address)).thresholdRepayAmount,
        // 0.5 is debt - dust and surcharge is 0.9
        parseEther('0.555555555555555555'),
        0.0001,
      );

      await vaultManager.connect(governor).setDusts(parseEther('1.5'), parseEther('1.5'), parseEther('1.5'));

      await displayVaultState(vaultManager, 2, log, collatBase);

      expectApprox(
        (await vaultManager.checkLiquidation(2, bob.address)).maxStablecoinAmountToRepay,
        parseEther(maxStablecoinAmountToRepay2.toString()),
        0.0001,
      );
      expectApprox(
        (await vaultManager.checkLiquidation(2, bob.address)).maxCollateralAmountGiven,
        parseUnits((maxStablecoinAmountToRepay2 / rate / discount).toFixed(10), collatBase),
        0.0001,
      );

      expect((await vaultManager.checkLiquidation(2, bob.address)).thresholdRepayAmount).to.be.equal(1);

      await expect(
        vaultManager.connect(bob)[
          // We still enter a really small amount
          'liquidate(uint256[],uint256[],address,address)'
        ]([2], [0], bob.address, bob.address),
      ).to.be.revertedWith('DustyLeftoverAmount');

      expect(await agToken.balanceOf(bob.address)).to.be.equal(borrowAmount.mul(10));
      expect(await collateral.balanceOf(bob.address)).to.be.equal(0);

      await vaultManager.connect(bob)[
        // We still enter a really small amount
        'liquidate(uint256[],uint256[],address,address)'
      ]([2], [4], bob.address, bob.address);

      expectApprox(
        await agToken.balanceOf(bob.address),
        borrowAmount.mul(10).sub(parseEther(maxStablecoinAmountToRepay2.toString())),
        0.1,
      );
      expectApprox(
        await collateral.balanceOf(bob.address),
        parseUnits((maxStablecoinAmountToRepay2 / rate / discount).toFixed(10), collatBase),
        0.1,
      );

      await displayVaultState(vaultManager, 2, log, collatBase);

      await expect(vaultManager.checkLiquidation(2, bob.address)).to.be.reverted;
      expect(await vaultManager.totalNormalizedDebt()).to.be.equal(0);
    });
    it('success - dustLiquidation but no dust', async () => {
      const collatAmount = parseUnits('2', collatBase);
      const borrowAmount = parseEther('1');

      await collateral.connect(alice).mint(alice.address, collatAmount);
      await collateral.connect(alice).approve(vaultManager.address, collatAmount);

      await stableMaster.connect(bob).mint(agToken.address, bob.address, borrowAmount.mul(10));
      await agToken.connect(bob).approve(vaultManager.address, borrowAmount);

      await angle(vaultManager, alice, [
        createVault(alice.address),
        createVault(alice.address),
        addCollateral(2, collatAmount),
        borrow(2, borrowAmount),
      ]);
      const rate = 0.6;
      await oracle.update(parseEther(rate.toString()));

      // This time discount is maxed
      const discount = Math.max((2 * rate * 0.8) / 1, 0.9);
      const maxStablecoinAmountToRepay = (1.1 - rate * 2 * 0.8) / (0.9 * 1.1 - 0.8 / discount);

      await displayVaultState(vaultManager, 2, log, collatBase);

      // This is approx equal to 0.89 over 1
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
      expect((await vaultManager.checkLiquidation(2, bob.address)).thresholdRepayAmount).to.be.equal(0);

      // There is no dust on the debt but there is on
      await vaultManager.connect(governor).setDusts(parseEther('0'), parseEther('0.5'), parseEther('0'));

      await displayVaultState(vaultManager, 2, log, collatBase);

      console.log((await vaultManager.checkLiquidation(2, bob.address)).maxStablecoinAmountToRepay.toString());

      const maxStablecoinAmountToRepay2 = 1 / 0.9;

      expectApprox(
        (await vaultManager.checkLiquidation(2, bob.address)).maxStablecoinAmountToRepay,
        parseEther(maxStablecoinAmountToRepay2.toString()),
        0.0001,
      );
      expectApprox(
        (await vaultManager.checkLiquidation(2, bob.address)).maxCollateralAmountGiven,
        parseUnits((maxStablecoinAmountToRepay2 / rate / discount).toFixed(10), collatBase),
        0.0001,
      );
      // Threshold repay amount is (debt - dust) / surcharge
      expectApprox(
        (await vaultManager.checkLiquidation(2, bob.address)).thresholdRepayAmount,
        // 0.5 is debt - dust and surcharge is 0.9
        parseEther('0.555555555555555555'),
        0.0001,
      );

      await vaultManager.connect(governor).setDusts(parseEther('0'), parseEther('1.5'), parseEther('0'));

      await displayVaultState(vaultManager, 2, log, collatBase);

      expectApprox(
        (await vaultManager.checkLiquidation(2, bob.address)).maxStablecoinAmountToRepay,
        parseEther(maxStablecoinAmountToRepay2.toString()),
        0.0001,
      );
      expectApprox(
        (await vaultManager.checkLiquidation(2, bob.address)).maxCollateralAmountGiven,
        parseUnits((maxStablecoinAmountToRepay2 / rate / discount).toFixed(10), collatBase),
        0.0001,
      );

      expect((await vaultManager.checkLiquidation(2, bob.address)).thresholdRepayAmount).to.be.equal(1);

      await vaultManager.connect(bob)[
        // We still enter a really small amount
        'liquidate(uint256[],uint256[],address,address)'
      ]([2], [0], bob.address, bob.address);
      expectApprox(
        (await vaultManager.checkLiquidation(2, bob.address)).maxStablecoinAmountToRepay,
        parseEther(maxStablecoinAmountToRepay2.toString()),
        0.0001,
      );
      expectApprox(
        (await vaultManager.checkLiquidation(2, bob.address)).maxCollateralAmountGiven,
        parseUnits((maxStablecoinAmountToRepay2 / rate / discount).toFixed(10), collatBase),
        0.0001,
      );

      expect((await vaultManager.checkLiquidation(2, bob.address)).thresholdRepayAmount).to.be.equal(1);

      expect(await agToken.balanceOf(bob.address)).to.be.equal(borrowAmount.mul(10));
      expect(await collateral.balanceOf(bob.address)).to.be.equal(0);

      await vaultManager.connect(bob)[
        // We still enter a really small amount
        'liquidate(uint256[],uint256[],address,address)'
      ]([2], [4], bob.address, bob.address);

      expectApprox(
        await agToken.balanceOf(bob.address),
        borrowAmount.mul(10).sub(parseEther(maxStablecoinAmountToRepay2.toString())),
        0.1,
      );
      expectApprox(
        await collateral.balanceOf(bob.address),
        parseUnits((maxStablecoinAmountToRepay2 / rate / discount).toFixed(10), collatBase),
        0.1,
      );

      await displayVaultState(vaultManager, 2, log, collatBase);

      await expect(vaultManager.checkLiquidation(2, bob.address)).to.be.reverted;
      expect(await vaultManager.totalNormalizedDebt()).to.be.equal(0);
    });
  });
});
