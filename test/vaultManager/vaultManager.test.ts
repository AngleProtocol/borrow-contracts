import { ActionType, CONTRACTS_ADDRESSES } from '@angleprotocol/sdk';
import { Oracle, Oracle__factory } from '@angleprotocol/sdk/dist/constants/types';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { Signer } from 'ethers';
import { parseEther, parseUnits } from 'ethers/lib/utils';
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
  closeVault,
  createVault,
  deployUpgradeable,
  expectApprox,
  ZERO_ADDRESS,
} from '../utils/helpers';

contract('VaultManager', () => {
  let deployer: SignerWithAddress;
  let governor: SignerWithAddress;
  let guardian: SignerWithAddress;
  let proxyAdmin: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let charlie: SignerWithAddress;

  let treasury: MockTreasury;
  let collateral: MockToken;
  let oracle: MockOracle;
  let stableMaster: MockStableMaster;
  let agToken: AgToken;
  let vaultManager: VaultManager;

  const impersonatedSigners: { [key: string]: Signer } = {};

  const collatBase = 10;
  const params = {
    dust: 100,
    dustCollateral: 100,
    debtCeiling: parseEther('100'),
    collateralFactor: parseUnits('0.5', 'gwei'),
    targetHealthFactor: parseUnits('1.1', 'gwei'),
    borrowFee: parseUnits('0.1', 'gwei'),
    interestRate: 100,
    liquidationSurcharge: parseUnits('0.9', 'gwei'),
    maxLiquidationDiscount: parseUnits('0.1', 'gwei'),
    liquidationBooster: parseUnits('0.1', 'gwei'),
    whitelistingActivated: false,
  };

  before(async () => {
    ({ deployer, alice, bob, charlie, governor, guardian, proxyAdmin } = await ethers.getNamedSigners());
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

    oracle = await new MockOracle__factory(deployer).deploy(parseUnits('2', 18), collatBase, treasury.address);
    await vaultManager.initialize(treasury.address, collateral.address, oracle.address, params);
    await vaultManager.connect(guardian).unpause();
  });

  describe('oracle', () => {
    it('success - read', async () => {
      const oracle = (await ethers.getContractAt(Oracle__factory.abi, await vaultManager.oracle())) as Oracle;
      expect(await oracle.read()).to.be.equal(parseUnits('2', 18));
    });
  });

  describe('angle', () => {
    it('revert - paused', async () => {
      await vaultManager.connect(guardian).pause();
      await expect(angle(vaultManager, alice, [createVault(alice.address)])).to.be.revertedWith('Pausable: paused');
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

  describe('borrow', () => {
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
    });
  });

  describe('liquidate', () => {
    it('success', async () => {
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

      expectApprox(await vaultManager.getVaultDebt(2), parseEther('1'), 0.1);

      await collateral.connect(bob).mint(bob.address, collatAmount);
      await collateral.connect(bob).approve(vaultManager.address, collatAmount);
      await angle(vaultManager, bob, [
        createVault(bob.address),
        createVault(bob.address),
        addCollateral(3, collatAmount),
        borrow(3, borrowAmount),
      ]);

      await oracle.update(parseEther('0.9'));

      // Liquidation enabled
      expect((await vaultManager.checkLiquidation(2, bob.address)).currentDebt).to.be.gt(0);

      await vaultManager
        .connect(bob)
        ['liquidate(uint256[],uint256[],address,address)']([2], [borrowAmount.div(2)], bob.address, bob.address);
      // TODO Does nothing
    });
  });
});
