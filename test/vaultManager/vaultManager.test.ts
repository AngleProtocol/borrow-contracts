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
} from '../../typechain';
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
  let mockSwapper: MockSwapper;
  let mockSwapperWithSwap: MockSwapperWithSwap;

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
    await vaultManager.connect(governor).setUint64(params.borrowFee, formatBytes32String('BF'));
  });
  describe('oracle', () => {
    it('success - read', async () => {
      const oracle = (await ethers.getContractAt(
        Oracle__factory.abi,
        await vaultManager.oracle(),
      )) as unknown as Oracle;
      expect(await oracle.read()).to.be.equal(parseUnits('2', 18));
    });
  });

  describe('createVault', () => {
    it('reverts - paused', async () => {
      await vaultManager.connect(guardian).togglePause();
      await expect(vaultManager.createVault(alice.address)).to.be.revertedWith('Paused');
    });
    it('reverts - zero address', async () => {
      await expect(vaultManager.createVault(ZERO_ADDRESS)).to.be.revertedWith('ZeroAddress');
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
      await expect(angle(vaultManager, alice, [createVault(alice.address)])).to.be.revertedWith('Paused');
    });

    it('success - state', async () => {
      await angle(vaultManager, alice, [createVault(alice.address), createVault(alice.address)]);
      expect(await vaultManager.balanceOf(alice.address)).to.be.equal(2);
      expect(await vaultManager.ownerOf(1)).to.be.equal(alice.address);
      expect(await vaultManager.ownerOf(2)).to.be.equal(alice.address);
    });

    it('reverts - not whitelisted', async () => {
      await vaultManager.connect(governor).toggleWhitelist(ZERO_ADDRESS);
      await expect(angle(vaultManager, alice, [createVault(alice.address)])).to.be.revertedWith('NotWhitelisted');
    });
    it('reverts - unknown action', async () => {
      await expect(
        vaultManager
          .connect(governor)
          ['angle(uint8[],bytes[],address,address)']([10], ['0x'], ZERO_ADDRESS, ZERO_ADDRESS),
      ).to.be.reverted;
    });
    it('reverts - zero length action', async () => {
      await expect(
        vaultManager.connect(governor)['angle(uint8[],bytes[],address,address)']([], [], ZERO_ADDRESS, ZERO_ADDRESS),
      ).to.be.revertedWith('IncompatibleLengths');
    });
    it('reverts - incompatible length', async () => {
      await expect(
        vaultManager.connect(governor)['angle(uint8[],bytes[],address,address)']([1], [], ZERO_ADDRESS, ZERO_ADDRESS),
      ).to.be.revertedWith('IncompatibleLengths');
    });

    it('success - whitelisted', async () => {
      await vaultManager.connect(governor).toggleWhitelist(ZERO_ADDRESS);
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
      await expect(angle(vaultManager, alice, [closeVault(2)])).to.be.revertedWith('InsolventVault');
    });
    it('success - totalNormalizedDebt updated and 0 borrow fee', async () => {
      await vaultManager.connect(governor).setUint64(0, formatBytes32String('BF'));
      await vaultManager.connect(governor).setUint64(0, formatBytes32String('IR'));
      await vaultManager.connect(governor).setUint64(0.5e9, formatBytes32String('LS'));
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
      expect((await vaultManager.vaultData(2)).normalizedDebt).to.be.equal(await vaultManager.totalNormalizedDebt());
      expect(await vaultManager.balanceOf(alice.address)).to.be.equal(2);
      expectApprox(await vaultManager.totalNormalizedDebt(), borrowAmount, 0.1);
      expect(await agToken.balanceOf(alice.address)).to.be.equal(borrowAmount.sub(1));
      const collateralBalance = await collateral.balanceOf(alice.address);
      await angle(vaultManager, alice, [closeVault(2)]);
      expect((await vaultManager.vaultData(2)).normalizedDebt).to.be.equal(0);
      expect((await vaultManager.vaultData(2)).collateralAmount).to.be.equal(0);
      await expect(vaultManager.ownerOf(2)).to.be.revertedWith('NonexistentVault');
      expect(await collateral.balanceOf(alice.address)).to.be.equal(collateralBalance.add(collatAmount));
      expect(await agToken.balanceOf(alice.address)).to.be.equal(0);
      expect(await vaultManager.totalNormalizedDebt()).to.be.equal(0);
      expect(await vaultManager.balanceOf(alice.address)).to.be.equal(1);
    });
    it('success - with repay fees 1/3', async () => {
      await vaultManager.connect(governor).setUint64(0, formatBytes32String('BF'));
      await vaultManager.connect(governor).setUint64(0, formatBytes32String('IR'));
      await vaultManager.connect(governor).setUint64(0.5e9, formatBytes32String('LS'));
      await vaultManager.connect(governor).setUint64(0.5e9, formatBytes32String('RF'));
      const collatAmount = parseUnits('2', collatBase);
      const borrowAmount = parseEther('1');
      await collateral.connect(alice).mint(alice.address, collatAmount);
      await collateral.connect(alice).approve(vaultManager.address, collatAmount);
      await treasury.connect(alice).addMinter(agToken.address, alice.address);
      await agToken.connect(alice).mint(alice.address, parseEther('10'));
      await angle(vaultManager, alice, [
        createVault(alice.address),
        createVault(alice.address),
        addCollateral(2, collatAmount),
        borrow(2, borrowAmount),
      ]);
      expect((await vaultManager.vaultData(2)).normalizedDebt).to.be.equal(await vaultManager.totalNormalizedDebt());
      expect(await vaultManager.balanceOf(alice.address)).to.be.equal(2);
      expectApprox(await vaultManager.totalNormalizedDebt(), borrowAmount, 0.1);
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('10').add(borrowAmount).sub(1));
      const collateralBalance = await collateral.balanceOf(alice.address);
      await angle(vaultManager, alice, [closeVault(2)]);
      expect((await vaultManager.vaultData(2)).normalizedDebt).to.be.equal(0);
      expect((await vaultManager.vaultData(2)).collateralAmount).to.be.equal(0);
      await expect(vaultManager.ownerOf(2)).to.be.revertedWith('NonexistentVault');
      expect(await collateral.balanceOf(alice.address)).to.be.equal(collateralBalance.add(collatAmount));
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('10').sub(borrowAmount).add(1));
      expect(await vaultManager.totalNormalizedDebt()).to.be.equal(0);
      expect(await vaultManager.balanceOf(alice.address)).to.be.equal(1);
      expect(await vaultManager.surplus()).to.be.equal(borrowAmount.sub(1));
    });
    it('success - with repay fees 2/3', async () => {
      await vaultManager.connect(governor).setUint64(0, formatBytes32String('BF'));
      await vaultManager.connect(governor).setUint64(0, formatBytes32String('IR'));
      await vaultManager.connect(governor).setUint64(0.5e9, formatBytes32String('LS'));
      await vaultManager.connect(governor).setUint64(0.005e9, formatBytes32String('RF'));
      const collatAmount = parseUnits('2', collatBase);
      const borrowAmount = parseEther('1');
      await collateral.connect(alice).mint(alice.address, collatAmount);
      await collateral.connect(alice).approve(vaultManager.address, collatAmount);
      await treasury.connect(alice).addMinter(agToken.address, alice.address);
      await agToken.connect(alice).mint(alice.address, parseEther('10'));
      await angle(vaultManager, alice, [
        createVault(alice.address),
        createVault(alice.address),
        addCollateral(2, collatAmount),
        borrow(2, borrowAmount),
      ]);
      expect((await vaultManager.vaultData(2)).normalizedDebt).to.be.equal(await vaultManager.totalNormalizedDebt());
      expect(await vaultManager.balanceOf(alice.address)).to.be.equal(2);
      expectApprox(await vaultManager.totalNormalizedDebt(), borrowAmount, 0.1);
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('10').add(borrowAmount).sub(1));
      const collateralBalance = await collateral.balanceOf(alice.address);
      await angle(vaultManager, alice, [closeVault(2)]);
      expect((await vaultManager.vaultData(2)).normalizedDebt).to.be.equal(0);
      expect((await vaultManager.vaultData(2)).collateralAmount).to.be.equal(0);
      await expect(vaultManager.ownerOf(2)).to.be.revertedWith('NonexistentVault');
      expect(await collateral.balanceOf(alice.address)).to.be.equal(collateralBalance.add(collatAmount));
      // Balance was 11 -> now repaying 1/0.995
      expectApprox(await agToken.balanceOf(alice.address), parseEther('10').sub(parseEther('0.00502513')).add(1), 0.01);
      expect(await vaultManager.totalNormalizedDebt()).to.be.equal(0);
      expect(await vaultManager.balanceOf(alice.address)).to.be.equal(1);
      expectApprox(await vaultManager.surplus(), parseEther('0.00502513'), 0.01);
    });
    it('success - with repay fees 3/3', async () => {
      await vaultManager.connect(governor).setUint64(0, formatBytes32String('BF'));
      await vaultManager.connect(governor).setUint64(0, formatBytes32String('IR'));
      await vaultManager.connect(governor).setUint64(0.5e9, formatBytes32String('LS'));
      await vaultManager.connect(governor).setUint64(0.001e9, formatBytes32String('RF'));
      const collatAmount = parseUnits('2', collatBase);
      const borrowAmount = parseEther('1');
      await collateral.connect(alice).mint(alice.address, collatAmount);
      await collateral.connect(alice).approve(vaultManager.address, collatAmount);
      await treasury.connect(alice).addMinter(agToken.address, alice.address);
      await agToken.connect(alice).mint(alice.address, parseEther('10'));
      await angle(vaultManager, alice, [
        createVault(alice.address),
        createVault(alice.address),
        addCollateral(2, collatAmount),
        borrow(2, borrowAmount),
      ]);
      expect((await vaultManager.vaultData(2)).normalizedDebt).to.be.equal(await vaultManager.totalNormalizedDebt());
      expect(await vaultManager.balanceOf(alice.address)).to.be.equal(2);
      expectApprox(await vaultManager.totalNormalizedDebt(), borrowAmount, 0.1);
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('10').add(borrowAmount).sub(1));
      const collateralBalance = await collateral.balanceOf(alice.address);
      await angle(vaultManager, alice, [closeVault(2)]);
      expect((await vaultManager.vaultData(2)).normalizedDebt).to.be.equal(0);
      expect((await vaultManager.vaultData(2)).collateralAmount).to.be.equal(0);
      await expect(vaultManager.ownerOf(2)).to.be.revertedWith('NonexistentVault');
      expect(await collateral.balanceOf(alice.address)).to.be.equal(collateralBalance.add(collatAmount));
      // Balance was 11 -> now repaying 1/0.999
      expectApprox(await agToken.balanceOf(alice.address), parseEther('10').sub(parseEther('0.001001')).add(1), 0.01);
      expect(await vaultManager.totalNormalizedDebt()).to.be.equal(0);
      expect(await vaultManager.balanceOf(alice.address)).to.be.equal(1);
      expectApprox(await vaultManager.surplus(), parseEther('0.001001'), 0.01);
    });

    it('success - with everything composed and a year', async () => {
      // 10% borrowing fee, 5% interest rate, 30% repaying fee
      const yearlyRate = 1.05;
      const ratePerSecond = yearlyRate ** (1 / (365 * 24 * 3600)) - 1;
      await vaultManager
        .connect(governor)
        .setUint64(parseUnits(ratePerSecond.toFixed(27), 27), formatBytes32String('IR'));
      await vaultManager.connect(governor).setUint64(0.1e9, formatBytes32String('BF'));
      await vaultManager.connect(governor).setUint64(0.5e9, formatBytes32String('LS'));
      await vaultManager.connect(governor).setUint64(0.3e9, formatBytes32String('RF'));
      const collatAmount = parseUnits('2', collatBase);
      const borrowAmount = parseEther('1');
      await collateral.connect(alice).mint(alice.address, collatAmount);
      await collateral.connect(alice).approve(vaultManager.address, collatAmount);
      await treasury.connect(alice).addMinter(agToken.address, alice.address);
      await agToken.connect(alice).mint(alice.address, parseEther('10'));
      await angle(vaultManager, alice, [
        createVault(alice.address),
        createVault(alice.address),
        addCollateral(2, collatAmount),
        borrow(2, borrowAmount),
      ]);
      expect((await vaultManager.vaultData(2)).normalizedDebt).to.be.equal(await vaultManager.totalNormalizedDebt());
      expect(await vaultManager.balanceOf(alice.address)).to.be.equal(2);
      expectApprox(await vaultManager.totalNormalizedDebt(), borrowAmount, 0.1);
      expect(await agToken.balanceOf(alice.address)).to.be.equal(
        parseEther('10').add(borrowAmount.mul(0.9e1).div(1e1)),
      );
      expect(await vaultManager.getVaultDebt(2)).to.be.equal(borrowAmount.sub(1));
      const collateralBalance = await collateral.balanceOf(alice.address);
      // Rounding issues here
      expect(await vaultManager.surplus()).to.be.equal(parseEther('0.1').sub(1));
      await increaseTime(365 * 24 * 3600);
      await angle(vaultManager, alice, [closeVault(2)]);
      // Debt of the person is borrowAmount * (1.05) -> and this person will have to repay borrowAmount * 1.05 / (1-0.3)
      // of stablecoins to close the position -> which makes 1.5 borrowAmount
      expect((await vaultManager.vaultData(2)).normalizedDebt).to.be.equal(0);
      expect((await vaultManager.vaultData(2)).collateralAmount).to.be.equal(0);
      await expect(vaultManager.ownerOf(2)).to.be.revertedWith('NonexistentVault');
      expect(await collateral.balanceOf(alice.address)).to.be.equal(collateralBalance.add(collatAmount));
      // Balance was 11 -> now repaying 1/0.999
      expectApprox(
        await agToken.balanceOf(alice.address),
        parseEther('10').add(borrowAmount.mul(0.9e1).div(1e1)).sub(borrowAmount.mul(1.5e1).div(1e1)).add(1),
        0.01,
      );
      expect(await vaultManager.totalNormalizedDebt()).to.be.equal(0);
      expect(await vaultManager.balanceOf(alice.address)).to.be.equal(1);
      // Protocol
      expectApprox(await vaultManager.surplus(), parseEther('0.1').add(parseEther('0.5')), 0.01);
    });
  });

  describe('addCollateral', () => {
    it('reverts - vault does not exist', async () => {
      const amount = parseUnits('1', collatBase);
      await collateral.connect(alice).mint(alice.address, amount);
      await collateral.connect(alice).approve(vaultManager.address, amount);
      await expect(
        angle(vaultManager, alice, [createVault(alice.address), createVault(alice.address), addCollateral(5, amount)]),
      ).to.be.revertedWith('NonexistentVault');
    });

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
      expect(await vaultManager.lastInterestAccumulatorUpdated()).to.be.equal(await latestTime());
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
        'InsolventVault',
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

      await expect(angle(vaultManager, alice, [borrow(2, borrowAmount)])).to.be.revertedWith('InsolventVault');
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

      await expect(angle(vaultManager, alice, [borrow(2, parseUnits('0.01', 9))])).to.be.revertedWith(
        'DustyLeftoverAmount',
      );
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
      await expect(angle(vaultManager, alice, [borrow(2, parseEther('101'))])).to.be.revertedWith(
        'DebtCeilingExceeded',
      );
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
      expect(await vaultManager.lastInterestAccumulatorUpdated()).to.be.equal(await latestTime());
      expectApprox(await vaultManager.getVaultDebt(2), parseEther('1.9989'), 0.1);
      expectApprox(await vaultManager.surplus(), parseEther('0.19989'), 0.01);
      await expect(vaultManager.checkLiquidation(2, alice.address)).to.be.revertedWith('HealthyVault');
    });
    it('success - in two transactions and some time passing for the interest rate accumulator to accrue', async () => {
      // Collat amount in stable should be 4
      // So max borrowable amount is 2
      const collatAmount = parseUnits('2', collatBase);
      const borrowAmount = parseEther('1.999');
      await collateral.connect(alice).mint(alice.address, collatAmount.mul(10));
      await collateral.connect(alice).approve(vaultManager.address, collatAmount.mul(10));
      await angle(vaultManager, alice, [
        createVault(alice.address),
        createVault(alice.address),
        addCollateral(2, collatAmount),
      ]);
      await increaseTime(365 * 24 * 3600);
      // Making sure that the interest rate accumulator has been updated
      const yearlyRate = 1.05;
      const ratePerSecond = yearlyRate ** (1 / (365 * 24 * 3600)) - 1;
      await vaultManager
        .connect(governor)
        .setUint64(parseUnits(ratePerSecond.toFixed(27), 27), formatBytes32String('IR'));
      await angle(vaultManager, alice, [borrow(2, borrowAmount)]);
      expect(await vaultManager.lastInterestAccumulatorUpdated()).to.be.equal(await latestTime());
      displayVaultState(vaultManager, 2, log, collatBase);
      expectApprox(await vaultManager.getVaultDebt(2), parseEther('1.998'), 0.1);
      expectApprox(await vaultManager.surplus(), parseEther('0.19989'), 0.01);
      await expect(vaultManager.checkLiquidation(2, alice.address)).to.be.revertedWith('HealthyVault');
      await increaseTime(365 * 24 * 3600);
      await vaultManager
        .connect(governor)
        .setUint64(parseUnits(ratePerSecond.toFixed(27), 27), formatBytes32String('IR'));
      expectApprox(await vaultManager.surplus(), parseEther('0.29989'), 0.1);
      await angle(vaultManager, alice, [addCollateral(2, collatAmount.mul(2)), borrow(2, borrowAmount)]);
      expect(await vaultManager.lastInterestAccumulatorUpdated()).to.be.equal(await latestTime());
      // Vault debt should be 1.998*1.05 + 1.998
      expectApprox(await vaultManager.getVaultDebt(2), parseEther('4.098'), 0.1);
      // Surplus should have accrued during this period: it should be 0.05*1.998+0.19989*2 =
      expectApprox(await vaultManager.surplus(), parseEther('0.49975'), 0.01);
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
      expect(await vaultManager.lastInterestAccumulatorUpdated()).to.be.equal(await latestTime());
      expectApprox(await vaultManager.getVaultDebt(2), parseEther('1.9989'), 0.1);
      expectApprox(await vaultManager.surplus(), parseEther('0.19989'), 0.01);
      await expect(vaultManager.checkLiquidation(2, alice.address)).to.be.revertedWith('HealthyVault');
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
      expect(await vaultManager.lastInterestAccumulatorUpdated()).to.be.equal(await latestTime());
      await angle(vaultManager, alice, [borrow(2, parseEther('1'))]);
      expect(await vaultManager.lastInterestAccumulatorUpdated()).to.be.equal(await latestTime());

      expectApprox(await vaultManager.getVaultDebt(2), parseEther('1.9989'), 0.1);
      expectApprox(await vaultManager.surplus(), parseEther('0.19989'), 0.01);
      await expect(vaultManager.checkLiquidation(2, alice.address)).to.be.revertedWith('HealthyVault');
    });

    it('success - check rounding and if it is always in the sense of the protocol', async () => {
      // Collat amount in stable should be 4
      // So max borrowable amount is 2
      await vaultManager.connect(governor).setUint64(0, formatBytes32String('BF'));
      await vaultManager.connect(governor).setUint64(0, formatBytes32String('IR'));
      await vaultManager.connect(governor).setUint64(0.5e9, formatBytes32String('LS'));
      await vaultManager.connect(governor).setUint64(0, formatBytes32String('RF'));
      const collatAmount = parseUnits('100000', collatBase);
      const borrowAmount = parseEther('1');
      await collateral.connect(alice).mint(alice.address, collatAmount);
      await collateral.connect(alice).approve(vaultManager.address, collatAmount);
      await angle(vaultManager, alice, [
        createVault(alice.address),
        createVault(alice.address),
        addCollateral(2, collatAmount),
        borrow(2, borrowAmount),
      ]);
      expect(await agToken.balanceOf(alice.address)).to.be.equal(borrowAmount.sub(1));
      expect(await vaultManager.getVaultDebt(2)).to.be.equal(borrowAmount.sub(1));
      expect(await vaultManager.lastInterestAccumulatorUpdated()).to.be.equal(await latestTime());
      await expect(vaultManager.checkLiquidation(2, alice.address)).to.be.revertedWith('HealthyVault');
      await angle(vaultManager, alice, [borrow(2, borrowAmount)]);
      expect(await agToken.balanceOf(alice.address)).to.be.equal(borrowAmount.mul(2).sub(2));
      // Debt is here higher than the agToken balance which is the desired output
      expect(await vaultManager.getVaultDebt(2)).to.be.equal(borrowAmount.mul(2).sub(1));
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
      expect(await vaultManager.lastInterestAccumulatorUpdated()).to.be.equal(await latestTime());
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
      expect(await vaultManager.lastInterestAccumulatorUpdated()).to.be.equal(await latestTime());
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
      expect(await vaultManager.lastInterestAccumulatorUpdated()).to.be.equal(await latestTime());
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
        'DustyLeftoverAmount',
      );
    });
    it('success - with repay fee in two tx', async () => {
      await vaultManager.connect(governor).setUint64(0, formatBytes32String('BF'));
      await vaultManager.connect(governor).setUint64(0, formatBytes32String('IR'));
      await vaultManager.connect(governor).setUint64(0.5e9, formatBytes32String('LS'));
      await vaultManager.connect(governor).setUint64(0.5e9, formatBytes32String('RF'));
      await treasury.connect(alice).addMinter(agToken.address, alice.address);
      await agToken.connect(alice).mint(alice.address, parseEther('10'));
      const collatAmount = parseUnits('2', collatBase);
      const borrowAmount = parseEther('2');
      await collateral.connect(alice).mint(alice.address, collatAmount.mul(2));
      await collateral.connect(alice).approve(vaultManager.address, collatAmount.mul(2));
      await angle(vaultManager, alice, [
        createVault(alice.address),
        createVault(alice.address),
        addCollateral(2, collatAmount.mul(2)),
        borrow(2, borrowAmount),
      ]);
      const aliceBalance = await agToken.balanceOf(alice.address);
      await angle(vaultManager, alice, [repayDebt(2, parseEther('1'))]);
      expect(await agToken.balanceOf(alice.address)).to.be.equal(aliceBalance.sub(parseEther('2')));
      expect(await vaultManager.lastInterestAccumulatorUpdated()).to.be.equal(await latestTime());
      expectApprox(await vaultManager.getVaultDebt(2), parseEther('1'), 0.1);
      expect(await vaultManager.surplus()).to.be.equal(parseEther('1'));
    });
    it('success - with repay fee in only one tx', async () => {
      await vaultManager.connect(governor).setUint64(0, formatBytes32String('BF'));
      await vaultManager.connect(governor).setUint64(0, formatBytes32String('IR'));
      await vaultManager.connect(governor).setUint64(0.5e9, formatBytes32String('LS'));
      await vaultManager.connect(governor).setUint64(0.5e9, formatBytes32String('RF'));
      await treasury.connect(alice).addMinter(agToken.address, alice.address);
      await agToken.connect(alice).mint(alice.address, parseEther('10'));
      const collatAmount = parseUnits('2', collatBase);
      const borrowAmount = parseEther('2');
      await collateral.connect(alice).mint(alice.address, collatAmount.mul(2));
      await collateral.connect(alice).approve(vaultManager.address, collatAmount.mul(2));
      const aliceBalance = await agToken.balanceOf(alice.address);
      await angle(vaultManager, alice, [
        createVault(alice.address),
        createVault(alice.address),
        addCollateral(2, collatAmount.mul(2)),
        borrow(2, borrowAmount),
        repayDebt(2, parseEther('1')),
      ]);
      // Rounding issues here
      expect(await agToken.balanceOf(alice.address)).to.be.equal(
        aliceBalance.add(borrowAmount).sub(parseEther('2').add(1)),
      );
      expect(await vaultManager.lastInterestAccumulatorUpdated()).to.be.equal(await latestTime());
      expectApprox(await vaultManager.getVaultDebt(2), parseEther('1'), 0.1);
      expect(await vaultManager.surplus()).to.be.equal(parseEther('1'));
    });
    it('success - with repay fee in one tx and some weird values 1/2', async () => {
      await vaultManager.connect(governor).setUint64(0, formatBytes32String('BF'));
      await vaultManager.connect(governor).setUint64(0, formatBytes32String('IR'));
      await vaultManager.connect(governor).setUint64(0.9e9, formatBytes32String('LS'));
      await vaultManager.connect(governor).setUint64(0.005e9, formatBytes32String('RF'));
      await treasury.connect(alice).addMinter(agToken.address, alice.address);
      await agToken.connect(alice).mint(alice.address, parseEther('10'));
      const collatAmount = parseUnits('2', collatBase);
      const borrowAmount = parseEther('2');
      await collateral.connect(alice).mint(alice.address, collatAmount.mul(2));
      await collateral.connect(alice).approve(vaultManager.address, collatAmount.mul(2));
      await angle(vaultManager, alice, [
        createVault(alice.address),
        createVault(alice.address),
        addCollateral(2, collatAmount.mul(2)),
        borrow(2, borrowAmount),
      ]);
      const aliceBalance = await agToken.balanceOf(alice.address);
      await angle(vaultManager, alice, [repayDebt(2, parseEther('1'))]);
      // Address is going to repay 1/0.995 =
      expectApprox(await agToken.balanceOf(alice.address), aliceBalance.sub(parseEther('1.005')), 0.001);
      expect(await vaultManager.lastInterestAccumulatorUpdated()).to.be.equal(await latestTime());
      expectApprox(await vaultManager.getVaultDebt(2), parseEther('1'), 0.1);
      expectApprox(await vaultManager.surplus(), parseEther('0.0050212'), 0.1);
    });
    it('success - with repay fee in one tx and some weird values 2/2', async () => {
      await vaultManager.connect(governor).setUint64(0, formatBytes32String('BF'));
      await vaultManager.connect(governor).setUint64(0, formatBytes32String('IR'));
      await vaultManager.connect(governor).setUint64(0.9e9, formatBytes32String('LS'));
      await vaultManager.connect(governor).setUint64(0.001e9, formatBytes32String('RF'));
      await treasury.connect(alice).addMinter(agToken.address, alice.address);
      await agToken.connect(alice).mint(alice.address, parseEther('10'));
      const collatAmount = parseUnits('2', collatBase);
      const borrowAmount = parseEther('2');
      await collateral.connect(alice).mint(alice.address, collatAmount.mul(2));
      await collateral.connect(alice).approve(vaultManager.address, collatAmount.mul(2));
      await angle(vaultManager, alice, [
        createVault(alice.address),
        createVault(alice.address),
        addCollateral(2, collatAmount.mul(2)),
        borrow(2, borrowAmount),
      ]);
      const aliceBalance = await agToken.balanceOf(alice.address);
      await angle(vaultManager, alice, [repayDebt(2, parseEther('1'))]);
      // Address is going to repay 1/0.999 = 1.001001
      expectApprox(await agToken.balanceOf(alice.address), aliceBalance.sub(parseEther('1.001001')), 0.001);
      expect(await vaultManager.lastInterestAccumulatorUpdated()).to.be.equal(await latestTime());
      expectApprox(await vaultManager.getVaultDebt(2), parseEther('1'), 0.1);
      expectApprox(await vaultManager.surplus(), parseEther('0.001001'), 0.1);
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
        new VaultManager__factory(deployer),
        0.1e9,
        0.1e9,
      )) as VaultManager;
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
        new VaultManager__factory(deployer),
        0.1e9,
        0.1e9,
      )) as VaultManager;
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
        new VaultManager__factory(deployer),
        0.1e9,
        0.1e9,
      )) as VaultManager;
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
        new VaultManager__factory(deployer),
        0.1e9,
        0.1e9,
      )) as VaultManager;
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
        new VaultManager__factory(deployer),
        0.1e9,
        0.1e9,
      )) as VaultManager;
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
      mockSwapper = (await new MockSwapper__factory(deployer).deploy()) as MockSwapper;
      mockSwapperWithSwap = (await new MockSwapperWithSwap__factory(deployer).deploy()) as MockSwapperWithSwap;
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
      const vaultManagerBalance = await collateral.balanceOf(vaultManager.address);
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
      expect(await collateral.balanceOf(vaultManager.address)).to.be.equal(vaultManagerBalance.add(collatAmount));
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
      ).to.be.revertedWith('BurnAmountExceedsAllowance');
    });
    it('success - stablecoin and collateral to be paid by the protocol', async () => {
      await angle(vaultManager, alice, [createVault(alice.address), addCollateral(3, collatAmount.mul(2))]);
      expect((await vaultManager.vaultData(3)).collateralAmount).to.be.equal(collatAmount.mul(2));
      const aliceStablecoinBalance = await agToken.balanceOf(alice.address);
      const aliceCollateralBalance = await collateral.balanceOf(alice.address);
      const vaultManagerBalance = await collateral.balanceOf(vaultManager.address);
      await angle(vaultManager, alice, [removeCollateral(3, collatAmount), borrow(3, borrowAmount)]);
      expect(await collateral.balanceOf(vaultManager.address)).to.be.equal(vaultManagerBalance.sub(collatAmount));
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
      const vaultManagerBalance = await collateral.balanceOf(vaultManager.address);
      await angle(
        vaultManager,
        alice,
        [removeCollateral(3, collatAmount), borrow(3, borrowAmount)],
        alice.address,
        bob.address,
        ZERO_ADDRESS,
        web3.utils.keccak256('test'),
      );
      expect(await collateral.balanceOf(vaultManager.address)).to.be.equal(vaultManagerBalance.sub(collatAmount));
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
      const vaultManagerBalance = await collateral.balanceOf(vaultManager.address);
      await angle(
        vaultManager,
        alice,
        [repayDebt(2, parseEther('1')), removeCollateral(2, collatAmount)],
        alice.address,
        alice.address,
        mockSwapper.address,
        web3.utils.keccak256('test'),
      );
      expect(await collateral.balanceOf(vaultManager.address)).to.be.equal(vaultManagerBalance.sub(collatAmount));
      expect((await vaultManager.vaultData(2)).collateralAmount).to.be.equal(collatAmount);
      expectApprox(await vaultManager.getVaultDebt(2), parseEther('0.9989'), 0.1);
      expect(await mockSwapper.counter()).to.be.equal(1);
      expect(await agToken.balanceOf(alice.address)).to.be.equal(aliceStablecoinBalance.sub(parseEther('1')));
      expect(await collateral.balanceOf(alice.address)).to.be.equal(aliceCollateralBalance.add(collatAmount));
    });
    it('success - handle repay with repay callee and null stablecoin amount to repay', async () => {
      const aliceStablecoinBalance = await agToken.balanceOf(alice.address);
      const aliceCollateralBalance = await collateral.balanceOf(alice.address);
      const vaultManagerBalance = await collateral.balanceOf(vaultManager.address);
      await angle(
        vaultManager,
        alice,
        [removeCollateral(2, collatAmount)],
        alice.address,
        alice.address,
        mockSwapper.address,
        web3.utils.keccak256('test'),
      );
      expect(await collateral.balanceOf(vaultManager.address)).to.be.equal(vaultManagerBalance.sub(collatAmount));
      expect((await vaultManager.vaultData(2)).collateralAmount).to.be.equal(collatAmount);
      expectApprox(await vaultManager.getVaultDebt(2), parseEther('1.9989'), 0.1);
      expect(await mockSwapper.counter()).to.be.equal(0);
      expect(await agToken.balanceOf(alice.address)).to.be.equal(aliceStablecoinBalance);
      expect(await collateral.balanceOf(alice.address)).to.be.equal(aliceCollateralBalance.add(collatAmount));
    });
    it('success - handle repay with repay callee, null stablecoin amount to repay and a different to address', async () => {
      const aliceStablecoinBalance = await agToken.balanceOf(alice.address);
      const aliceCollateralBalance = await collateral.balanceOf(alice.address);
      const bobStablecoinBalance = await agToken.balanceOf(bob.address);
      const bobCollateralBalance = await collateral.balanceOf(bob.address);
      const vaultManagerBalance = await collateral.balanceOf(vaultManager.address);
      await angle(
        vaultManager,
        alice,
        [removeCollateral(2, collatAmount)],
        alice.address,
        bob.address,
        mockSwapper.address,
        web3.utils.keccak256('test'),
      );
      expect(await collateral.balanceOf(vaultManager.address)).to.be.equal(vaultManagerBalance.sub(collatAmount));
      expect((await vaultManager.vaultData(2)).collateralAmount).to.be.equal(collatAmount);
      expectApprox(await vaultManager.getVaultDebt(2), parseEther('1.9989'), 0.1);
      expect(await mockSwapper.counter()).to.be.equal(0);
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
          mockSwapper.address,
          web3.utils.keccak256('test'),
        ),
      ).to.be.revertedWith('BurnAmountExceedsAllowance');
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
      const vaultManagerBalance = await collateral.balanceOf(vaultManager.address);
      await agToken.connect(bob).approve(alice.address, parseEther('10'));
      await angle(
        vaultManager,
        alice,
        [repayDebt(2, parseEther('1')), removeCollateral(2, collatAmount)],
        bob.address,
        bob.address,
        mockSwapper.address,
        web3.utils.keccak256('test'),
      );
      expect(await collateral.balanceOf(vaultManager.address)).to.be.equal(vaultManagerBalance.sub(collatAmount));
      expect((await vaultManager.vaultData(2)).collateralAmount).to.be.equal(collatAmount);
      expect(await mockSwapper.counter()).to.be.equal(1);
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
          mockSwapper.address,
          web3.utils.keccak256('test'),
        ),
      ).to.be.reverted;
    });
    it('success - handle repay with an approved address but no who contract', async () => {
      const aliceStablecoinBalance = await agToken.balanceOf(alice.address);
      const aliceCollateralBalance = await collateral.balanceOf(alice.address);
      const bobStablecoinBalance = await agToken.balanceOf(bob.address);
      const bobCollateralBalance = await collateral.balanceOf(bob.address);
      const vaultManagerBalance = await collateral.balanceOf(vaultManager.address);
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
      expect(await collateral.balanceOf(vaultManager.address)).to.be.equal(vaultManagerBalance.sub(collatAmount));
      expect((await vaultManager.vaultData(2)).collateralAmount).to.be.equal(collatAmount);
      expect(await mockSwapper.counter()).to.be.equal(0);
      expectApprox(await vaultManager.getVaultDebt(2), parseEther('0.9989'), 0.1);
      expect(await collateral.balanceOf(bob.address)).to.be.equal(bobCollateralBalance.add(collatAmount));
      expect(await collateral.balanceOf(alice.address)).to.be.equal(aliceCollateralBalance);
      expect(await agToken.balanceOf(alice.address)).to.be.equal(aliceStablecoinBalance);
      expectApprox(await agToken.balanceOf(bob.address), bobStablecoinBalance.sub(parseEther('1')), 0.1);
    });
    it('success - handle repay with an approved address and a who contract which has the collateral', async () => {
      const aliceStablecoinBalance = await agToken.balanceOf(alice.address);
      const aliceCollateralBalance = await collateral.balanceOf(alice.address);
      const bobStablecoinBalance = await agToken.balanceOf(bob.address);
      const bobCollateralBalance = await collateral.balanceOf(bob.address);
      const vaultManagerBalance = await collateral.balanceOf(vaultManager.address);
      await agToken.connect(bob).approve(alice.address, parseEther('10'));
      await treasury.connect(alice).addMinter(agToken.address, alice.address);
      await agToken.connect(alice).mint(mockSwapperWithSwap.address, parseEther('10'));
      await angle(
        vaultManager,
        alice,
        [repayDebt(2, parseEther('1')), removeCollateral(2, collatAmount)],
        bob.address,
        mockSwapperWithSwap.address,
        mockSwapperWithSwap.address,
        web3.utils.keccak256('test'),
      );
      expect(await collateral.balanceOf(vaultManager.address)).to.be.equal(vaultManagerBalance.sub(collatAmount));
      expect((await vaultManager.vaultData(2)).collateralAmount).to.be.equal(collatAmount);
      expect(await mockSwapperWithSwap.counter()).to.be.equal(1);
      expectApprox(await vaultManager.getVaultDebt(2), parseEther('0.9989'), 0.1);
      expect(await collateral.balanceOf(bob.address)).to.be.equal(bobCollateralBalance);
      expect(await collateral.balanceOf(mockSwapperWithSwap.address)).to.be.equal(collatAmount);
      expect(await collateral.balanceOf(alice.address)).to.be.equal(aliceCollateralBalance);
      expect(await agToken.balanceOf(alice.address)).to.be.equal(aliceStablecoinBalance);
      expect(await agToken.balanceOf(bob.address)).to.be.equal(bobStablecoinBalance);
      expectApprox(await agToken.balanceOf(mockSwapperWithSwap.address), parseEther('10').sub(parseEther('1')), 0.1);
    });
    it('reverts - handle repay with repay data but no who contract', async () => {
      await agToken.connect(bob).approve(alice.address, parseEther('10'));
      await treasury.connect(alice).addMinter(agToken.address, alice.address);
      await agToken.connect(alice).mint(mockSwapperWithSwap.address, parseEther('10'));
      await expect(
        angleUnprotected(
          vaultManager,
          alice,
          [repayDebt(2, parseEther('1')), removeCollateral(2, collatAmount)],
          bob.address,
          mockSwapperWithSwap.address,
          ZERO_ADDRESS,
          web3.utils.keccak256('test'),
        ),
      ).to.be.reverted;
    });
    it('success - swapToCollateral with the same from and to address', async () => {
      const aliceStablecoinBalance = await agToken.balanceOf(alice.address);
      const aliceCollateralBalance = await collateral.balanceOf(alice.address);
      const vaultManagerBalance = await collateral.balanceOf(vaultManager.address);
      await angle(
        vaultManager,
        alice,
        [addCollateral(2, collatAmount), borrow(2, borrowAmount)],
        alice.address,
        alice.address,
        mockSwapper.address,
        web3.utils.keccak256('test'),
      );
      expect(await collateral.balanceOf(vaultManager.address)).to.be.equal(vaultManagerBalance.add(collatAmount));
      expect((await vaultManager.vaultData(2)).collateralAmount).to.be.equal(collatAmount.mul(3));
      expectApprox(await vaultManager.getVaultDebt(2), parseEther('3.9989'), 0.1);
      expect(await mockSwapper.counter()).to.be.equal(1);
      expect(await collateral.balanceOf(alice.address)).to.be.equal(aliceCollateralBalance.sub(collatAmount));
      expectApprox(await agToken.balanceOf(alice.address), aliceStablecoinBalance.add(adjustedBorrowAmount), 0.1);
    });
    it('success - swapToCollateral different from address has no impact 1/2', async () => {
      const aliceStablecoinBalance = await agToken.balanceOf(alice.address);
      const aliceCollateralBalance = await collateral.balanceOf(alice.address);
      const bobStablecoinBalance = await agToken.balanceOf(bob.address);
      const bobCollateralBalance = await collateral.balanceOf(bob.address);
      const vaultManagerBalance = await collateral.balanceOf(vaultManager.address);
      await angle(
        vaultManager,
        alice,
        [addCollateral(2, collatAmount), borrow(2, borrowAmount)],
        bob.address,
        alice.address,
        mockSwapper.address,
        web3.utils.keccak256('test'),
      );
      expect(await collateral.balanceOf(vaultManager.address)).to.be.equal(vaultManagerBalance.add(collatAmount));
      expect((await vaultManager.vaultData(2)).collateralAmount).to.be.equal(collatAmount.mul(3));
      expectApprox(await vaultManager.getVaultDebt(2), parseEther('3.9989'), 0.1);
      expect(await mockSwapper.counter()).to.be.equal(1);
      expect(await collateral.balanceOf(alice.address)).to.be.equal(aliceCollateralBalance.sub(collatAmount));
      expectApprox(await agToken.balanceOf(alice.address), aliceStablecoinBalance.add(adjustedBorrowAmount), 0.1);
      expect(await collateral.balanceOf(bob.address)).to.be.equal(bobCollateralBalance);
      expect(await agToken.balanceOf(bob.address)).to.be.equal(bobStablecoinBalance);
    });
    it('success - swapToCollateral and from address change has no impact 2/2', async () => {
      const aliceStablecoinBalance = await agToken.balanceOf(alice.address);
      const aliceCollateralBalance = await collateral.balanceOf(alice.address);
      const vaultManagerBalance = await collateral.balanceOf(vaultManager.address);
      await angle(
        vaultManager,
        alice,
        [addCollateral(2, collatAmount), borrow(2, borrowAmount)],
        ZERO_ADDRESS,
        alice.address,
        mockSwapper.address,
        web3.utils.keccak256('test'),
      );
      expect(await collateral.balanceOf(vaultManager.address)).to.be.equal(vaultManagerBalance.add(collatAmount));
      expect((await vaultManager.vaultData(2)).collateralAmount).to.be.equal(collatAmount.mul(3));
      expectApprox(await vaultManager.getVaultDebt(2), parseEther('3.9989'), 0.1);
      expect(await mockSwapper.counter()).to.be.equal(1);
      expect(await collateral.balanceOf(alice.address)).to.be.equal(aliceCollateralBalance.sub(collatAmount));
      expectApprox(await agToken.balanceOf(alice.address), aliceStablecoinBalance.add(adjustedBorrowAmount), 0.1);
    });
    it('success - swapToCollateral with a mockSwapperWithSwap contract', async () => {
      const aliceStablecoinBalance = await agToken.balanceOf(alice.address);
      const aliceCollateralBalance = await collateral.balanceOf(alice.address);
      const vaultManagerBalance = await collateral.balanceOf(vaultManager.address);
      await collateral.connect(alice).mint(mockSwapperWithSwap.address, collatAmount.mul(100));
      await angle(
        vaultManager,
        alice,
        [addCollateral(2, collatAmount), borrow(2, borrowAmount)],
        alice.address,
        mockSwapperWithSwap.address,
        mockSwapperWithSwap.address,
        web3.utils.keccak256('test'),
      );
      expect(await collateral.balanceOf(vaultManager.address)).to.be.equal(vaultManagerBalance.add(collatAmount));
      expect((await vaultManager.vaultData(2)).collateralAmount).to.be.equal(collatAmount.mul(3));
      expectApprox(await vaultManager.getVaultDebt(2), parseEther('3.9989'), 0.1);
      expect(await mockSwapperWithSwap.counter()).to.be.equal(1);
      expect(await collateral.balanceOf(alice.address)).to.be.equal(aliceCollateralBalance);
      expect(await collateral.balanceOf(mockSwapperWithSwap.address)).to.be.equal(collatAmount.mul(99));
      expect(await agToken.balanceOf(alice.address)).to.be.equal(aliceStablecoinBalance);
      expectApprox(await agToken.balanceOf(mockSwapperWithSwap.address), adjustedBorrowAmount, 0.1);
    });
    it('reverts - swapToCollateral with repayData but no who contract', async () => {
      await collateral.connect(alice).mint(mockSwapperWithSwap.address, collatAmount.mul(100));
      await expect(
        angleUnprotected(
          vaultManager,
          alice,
          [addCollateral(2, collatAmount), borrow(2, borrowAmount)],
          alice.address,
          mockSwapperWithSwap.address,
          ZERO_ADDRESS,
          web3.utils.keccak256('test'),
        ),
      ).to.be.reverted;
    });
    it('reverts - swapToCollateral Swapper fails to put the correct balance', async () => {
      const aliceCollateralBalance = await collateral.balanceOf(alice.address);
      await collateral.connect(alice).transfer(bob.address, aliceCollateralBalance);
      await expect(
        angle(
          vaultManager,
          alice,
          [addCollateral(2, collatAmount), borrow(2, borrowAmount)],
          bob.address,
          charlie.address,
          mockSwapper.address,
          web3.utils.keccak256('test'),
        ),
      ).to.be.reverted;
    });
    it('success - swapToCollateral different from address and to address', async () => {
      const aliceStablecoinBalance = await agToken.balanceOf(alice.address);
      const aliceCollateralBalance = await collateral.balanceOf(alice.address);
      const bobStablecoinBalance = await agToken.balanceOf(bob.address);
      const bobCollateralBalance = await collateral.balanceOf(bob.address);
      const vaultManagerBalance = await collateral.balanceOf(vaultManager.address);
      await angle(
        vaultManager,
        alice,
        [addCollateral(2, collatAmount), borrow(2, borrowAmount)],
        bob.address,
        charlie.address,
        mockSwapper.address,
        web3.utils.keccak256('test'),
      );
      expect(await collateral.balanceOf(vaultManager.address)).to.be.equal(vaultManagerBalance.add(collatAmount));
      expect((await vaultManager.vaultData(2)).collateralAmount).to.be.equal(collatAmount.mul(3));
      expectApprox(await vaultManager.getVaultDebt(2), parseEther('3.9989'), 0.1);
      expect(await mockSwapper.counter()).to.be.equal(1);
      expect(await collateral.balanceOf(alice.address)).to.be.equal(aliceCollateralBalance.sub(collatAmount));
      expect(await agToken.balanceOf(alice.address)).to.be.equal(aliceStablecoinBalance);
      expect(await collateral.balanceOf(bob.address)).to.be.equal(bobCollateralBalance);
      expect(await agToken.balanceOf(bob.address)).to.be.equal(bobStablecoinBalance);
      expectApprox(await agToken.balanceOf(charlie.address), adjustedBorrowAmount, 0.1);
    });
    it('reverts - swapToCollateral who address is invalid', async () => {
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
    it('success - swapToCollateral situation with no repay callee', async () => {
      const aliceStablecoinBalance = await agToken.balanceOf(alice.address);
      const aliceCollateralBalance = await collateral.balanceOf(alice.address);
      const vaultManagerBalance = await collateral.balanceOf(vaultManager.address);
      await angle(
        vaultManager,
        alice,
        [addCollateral(2, collatAmount), borrow(2, borrowAmount)],
        alice.address,
        alice.address,
        mockSwapper.address,
        '0x',
      );
      expect(await collateral.balanceOf(vaultManager.address)).to.be.equal(vaultManagerBalance.add(collatAmount));
      expect((await vaultManager.vaultData(2)).collateralAmount).to.be.equal(collatAmount.mul(3));
      expectApprox(await vaultManager.getVaultDebt(2), parseEther('3.9989'), 0.1);
      expect(await mockSwapper.counter()).to.be.equal(0);
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
  describe('accrueInterestToTreasury', () => {
    it('reverts - non treasury', async () => {
      await expect(vaultManager.accrueInterestToTreasury()).to.be.revertedWith('NotTreasury');
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
        new utils.Interface(['event InterestAccumulatorUpdated(uint256 value, uint256 timestamp)']),
        'InterestAccumulatorUpdated',
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
        new utils.Interface(['event InterestAccumulatorUpdated(uint256 value, uint256 timestamp)']),
        'InterestAccumulatorUpdated',
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
      const maxStablecoinAmountToRepay = (await vaultManager.checkLiquidation(2, bob.address))
        .maxStablecoinAmountToRepay;
      await vaultManager
        .connect(bob)
        ['liquidate(uint256[],uint256[],address,address)']([2], [maxStablecoinAmountToRepay], bob.address, bob.address);
      expectApprox(
        await vaultManager.badDebt(),
        borrowAmount.sub(maxStablecoinAmountToRepay.mul(params.liquidationSurcharge).div(1e9)),
        0.001,
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
        new utils.Interface(['event InterestAccumulatorUpdated(uint256 value, uint256 timestamp)']),
        'InterestAccumulatorUpdated',
        {
          timestamp: await latestTime(),
        },
      );
      expect(await vaultManager.surplus()).to.be.equal(0);
      expect(await vaultManager.badDebt()).to.be.equal(0);
      expect(await vaultManager.totalNormalizedDebt()).to.be.equal(0);
    });
  });

  describe('used vaultId 0 to manage new vault', () => {
    it('success - addCollateral', async () => {
      const collatAmount = parseUnits('2', collatBase);
      await collateral.connect(alice).mint(alice.address, collatAmount.mul(2));
      await collateral.connect(alice).approve(vaultManager.address, collatAmount.mul(2));
      await angle(vaultManager, alice, [
        createVault(alice.address),
        addCollateral(0, collatAmount),
        createVault(alice.address),
        addCollateral(0, collatAmount),
      ]);
      expect((await vaultManager.vaultData(1)).collateralAmount).to.be.equal(collatAmount);
      expect((await vaultManager.vaultData(2)).collateralAmount).to.be.equal(collatAmount);
    });

    it('success - borrow', async () => {
      const collatAmount = parseUnits('2', collatBase);
      const borrowAmount = parseEther('0.5');

      await collateral.connect(alice).mint(alice.address, collatAmount.mul(2));
      await collateral.connect(alice).approve(vaultManager.address, collatAmount.mul(2));
      await angle(vaultManager, alice, [
        createVault(alice.address),
        addCollateral(0, collatAmount),
        borrow(0, borrowAmount),
        createVault(alice.address),
        addCollateral(0, collatAmount),
        borrow(0, borrowAmount),
      ]);
      expect((await vaultManager.vaultData(1)).collateralAmount).to.be.equal(collatAmount);
      expectApprox(await vaultManager.getVaultDebt(1), borrowAmount, 0.0001);
      expect((await vaultManager.vaultData(2)).collateralAmount).to.be.equal(collatAmount);
      expectApprox(await vaultManager.getVaultDebt(2), borrowAmount, 0.0001);
    });

    it('success - removeCollateral', async () => {
      const collatAmount = parseUnits('2', collatBase);
      await collateral.connect(alice).mint(alice.address, collatAmount.mul(2));
      await collateral.connect(alice).approve(vaultManager.address, collatAmount.mul(2));
      await angle(vaultManager, alice, [
        createVault(alice.address),
        addCollateral(0, collatAmount),
        removeCollateral(0, collatAmount.div(2)),
        createVault(alice.address),
        addCollateral(0, collatAmount),
        removeCollateral(0, collatAmount.div(2)),
      ]);
      expect((await vaultManager.vaultData(1)).collateralAmount).to.be.equal(collatAmount.div(2));
      expect((await vaultManager.vaultData(2)).collateralAmount).to.be.equal(collatAmount.div(2));
    });

    it('success - repay', async () => {
      const collatAmount = parseUnits('2', collatBase);
      const borrowAmount = parseEther('0.5');

      await collateral.connect(alice).mint(alice.address, collatAmount.mul(2));
      await collateral.connect(alice).approve(vaultManager.address, collatAmount.mul(2));
      await angle(vaultManager, alice, [
        createVault(alice.address),
        addCollateral(0, collatAmount),
        borrow(0, borrowAmount),
        repayDebt(0, borrowAmount.div(2)),
        createVault(alice.address),
        addCollateral(0, collatAmount),
        borrow(0, borrowAmount),
        repayDebt(0, borrowAmount.div(2)),
      ]);
      expect((await vaultManager.vaultData(1)).collateralAmount).to.be.equal(collatAmount);
      expectApprox(await vaultManager.getVaultDebt(1), borrowAmount.div(2), 0.0001);
      expect((await vaultManager.vaultData(2)).collateralAmount).to.be.equal(collatAmount);
      expectApprox(await vaultManager.getVaultDebt(2), borrowAmount.div(2), 0.0001);
    });

    it('success - closeVault', async () => {
      await angle(vaultManager, alice, [createVault(alice.address), closeVault(0)]);
      await expect(vaultManager.ownerOf(1)).to.be.revertedWith('NonexistentVault');
    });

    it('success - getDebtIn', async () => {
      const collatAmount = parseUnits('2', collatBase);
      const borrowAmount = parseEther('1.999');
      await collateral.connect(alice).mint(alice.address, collatAmount.mul(10));
      await collateral.connect(alice).approve(vaultManager.address, collatAmount.mul(10));
      await angle(vaultManager, alice, [
        createVault(alice.address),
        addCollateral(1, collatAmount),
        borrow(1, borrowAmount),
      ]);
      expectApprox(await vaultManager.getVaultDebt(1), parseEther('1.9989'), 0.1);
      await angle(vaultManager, alice, [
        createVault(alice.address),
        addCollateral(0, collatAmount),
        getDebtIn(0, vaultManager.address, 1, parseEther('1')),
      ]);
      expectApprox(await vaultManager.getVaultDebt(1), parseEther('1'), 0.1);
      expectApprox(await vaultManager.getVaultDebt(2), parseEther('1'), 0.1);
    });
  });

  describe('tracking interest', () => {
    it('success - when two people come in', async () => {
      const collatAmount = parseUnits('2', collatBase);
      const borrowAmount = parseEther('1');
      // Setting 0 borrow fee
      await vaultManager.connect(governor).setUint64(0, formatBytes32String('BF'));
      expect(await vaultManager.borrowFee()).to.be.equal(0);

      await collateral.connect(alice).mint(alice.address, collatAmount.mul(10));
      await collateral.connect(alice).approve(vaultManager.address, collatAmount.mul(10));
      await collateral.connect(alice).mint(bob.address, collatAmount.mul(10));
      await collateral.connect(bob).approve(vaultManager.address, collatAmount.mul(10));
      await collateral.connect(alice).mint(charlie.address, collatAmount.mul(10));
      await collateral.connect(charlie).approve(vaultManager.address, collatAmount.mul(10));
      await angle(vaultManager, alice, [
        createVault(alice.address),
        addCollateral(1, collatAmount),
        borrow(1, borrowAmount),
      ]);
      expectApprox(await vaultManager.getVaultDebt(1), parseEther('1'), 0.1);
      await increaseTime(365 * 24 * 3600);
      expectApprox(await vaultManager.getVaultDebt(1), parseEther('1.05'), 0.01);
      await angle(vaultManager, bob, [
        createVault(bob.address),
        addCollateral(0, collatAmount),
        borrow(0, borrowAmount),
      ]);
      expectApprox(await vaultManager.surplus(), parseEther('0.05'), 0.1);
      expectApprox(await vaultManager.interestAccumulator(), parseUnits('1.05', 27), 0.1);
      await increaseTime(365 * 24 * 3600);
      // Here debt should be 1.05 * 1.05 = 1.1025
      expectApprox(await vaultManager.getVaultDebt(1), parseEther('1.1025'), 0.01);
      expectApprox(await vaultManager.getVaultDebt(2), parseEther('1.05'), 0.01);
      await angle(vaultManager, charlie, [
        createVault(charlie.address),
        addCollateral(0, collatAmount),
        borrow(0, borrowAmount),
      ]);
      // Interest accumulator tracks accumulation of 5% for two years
      expectApprox(await vaultManager.interestAccumulator(), parseUnits('1.1025', 27), 0.1);
      expectApprox(await vaultManager.surplus(), parseEther('0.1525'), 0.1);
    });
    it('success - when three people come in and varying time frames', async () => {
      const collatAmount = parseUnits('2', collatBase);
      const borrowAmount = parseEther('1');
      // Setting 0 borrow fee
      await vaultManager.connect(governor).setUint64(0, formatBytes32String('BF'));
      expect(await vaultManager.borrowFee()).to.be.equal(0);

      await collateral.connect(alice).mint(alice.address, collatAmount.mul(10));
      await collateral.connect(alice).approve(vaultManager.address, collatAmount.mul(10));
      await collateral.connect(alice).mint(bob.address, collatAmount.mul(10));
      await collateral.connect(bob).approve(vaultManager.address, collatAmount.mul(10));
      await collateral.connect(alice).mint(charlie.address, collatAmount.mul(10));
      await collateral.connect(charlie).approve(vaultManager.address, collatAmount.mul(10));
      await angle(vaultManager, alice, [
        createVault(alice.address),
        addCollateral(1, collatAmount),
        borrow(1, borrowAmount),
      ]);
      expectApprox(await vaultManager.getVaultDebt(1), parseEther('1'), 0.1);
      // 10 years
      await increaseTime(365 * 24 * 3600 * 10);
      expectApprox(await vaultManager.getVaultDebt(1), parseEther('1.6278946'), 0.01);
      await angle(vaultManager, bob, [
        createVault(bob.address),
        addCollateral(0, collatAmount),
        borrow(0, borrowAmount),
      ]);
      // Here debt should be 1.05^10 = 1.6288946
      expectApprox(await vaultManager.surplus(), parseEther('0.6278946'), 0.1);
      expectApprox(await vaultManager.interestAccumulator(), parseUnits('1.6278946', 27), 0.1);
      await increaseTime(365 * 24 * 3600);
      expectApprox(await vaultManager.getVaultDebt(1), parseEther('1.7093393'), 0.01);
      expectApprox(await vaultManager.getVaultDebt(2), parseEther('1.05'), 0.01);
      await angle(vaultManager, charlie, [
        createVault(charlie.address),
        addCollateral(0, collatAmount),
        borrow(0, borrowAmount),
      ]);
      // Interest accumulator tracks accumulation of 5% for 11 years
      expectApprox(await vaultManager.interestAccumulator(), parseUnits('1.7093393', 27), 0.1);
      expectApprox(await vaultManager.surplus(), parseEther('0.759'), 0.1);
      await increaseTime(365 * 24 * 3600);
      await angle(vaultManager, alice, [
        createVault(alice.address),
        addCollateral(0, collatAmount),
        borrow(0, borrowAmount),
      ]);
      expectApprox(await vaultManager.getVaultDebt(1), parseEther('1.79469'), 0.01);
      expectApprox(await vaultManager.getVaultDebt(2), parseEther('1.1025'), 0.01);
      expectApprox(await vaultManager.getVaultDebt(3), parseEther('1.05'), 0.01);
      expectApprox(await vaultManager.interestAccumulator(), parseUnits('1.79469', 27), 0.1);
      // Surplus is 0.79585 + 0.1025 + 0.05
      expectApprox(await vaultManager.surplus(), parseEther('0.947'), 0.1);
    });
  });
});
