import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { Signer, utils } from 'ethers';
import { parseEther } from 'ethers/lib/utils';
import hre, { contract, ethers } from 'hardhat';
import { inReceipt, inIndirectReceipt } from '../utils/expectEvent';
import { parseAmount } from '../../utils/bignumber';

import {
  MockCoreBorrow,
  MockCoreBorrow__factory,
  MockToken,
  MockToken__factory,
  Treasury,
  Treasury__factory,
} from '../../typechain';
import { expect } from '../utils/chai-setup';
import { deployUpgradeable, ZERO_ADDRESS } from '../utils/helpers';

contract('Treasury', () => {
  let deployer: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  let coreBorrow: MockCoreBorrow;
  let stablecoin: MockToken;
  let governor: string;
  let treasury: Treasury;

  const impersonatedSigners: { [key: string]: Signer } = {};

  before(async () => {
    [deployer, alice, bob] = await ethers.getSigners();
    // add any addresses you want to impersonate here
    governor = '0xdC4e6DFe07EFCa50a197DF15D9200883eF4Eb1c8';
    const impersonatedAddresses = [governor];

    for (const address of impersonatedAddresses) {
      await hre.network.provider.request({
        method: 'hardhat_impersonateAccount',
        params: [address],
      });
      await hre.network.provider.send('hardhat_setBalance', [address, '0x10000000000000000000000000000']);
      impersonatedSigners[address] = await ethers.getSigner(address);
    }
  });

  beforeEach(async () => {
    // If the forked-network state needs to be reset between each test, run this
    // await network.provider.request({method: 'hardhat_reset', params: []});

    // To deploy a contract, import and use the contract factory specific to that contract

    treasury = (await deployUpgradeable(new Treasury__factory(deployer))) as Treasury;
    coreBorrow = (await new MockCoreBorrow__factory(deployer).deploy()) as MockCoreBorrow;

    stablecoin = (await new MockToken__factory(deployer).deploy('agEUR', 'agEUR', 18)) as MockToken;
    await coreBorrow.toggleGovernor(governor);
    await coreBorrow.toggleGuardian(governor);
    await treasury.initialize(coreBorrow.address, stablecoin.address);
  });

  describe('initializer', () => {
    it('success - stablecoin, core', async () => {
      expect(await treasury.core()).to.be.equal(coreBorrow.address);
      expect(await treasury.stablecoin()).to.be.equal(stablecoin.address);
      expect(await treasury.surplusManager()).to.be.equal(ZERO_ADDRESS);
      expect(await treasury.badDebt()).to.be.equal(0);
      expect(await treasury.surplusBuffer()).to.be.equal(0);
      expect(await treasury.surplusForGovernance()).to.be.equal(0);
    });
    it('reverts - already initialized', async () => {
      await expect(treasury.initialize(coreBorrow.address, stablecoin.address)).to.be.revertedWith(
        'Initializable: contract is already initialized',
      );
    });
    it('reverts - zero addresses', async () => {
      const treasuryRevert = (await deployUpgradeable(new Treasury__factory(deployer))) as Treasury;
      await expect(treasuryRevert.initialize(coreBorrow.address, ZERO_ADDRESS)).to.be.reverted;
      await expect(treasuryRevert.initialize(ZERO_ADDRESS, stablecoin.address)).to.be.reverted;
      await expect(treasuryRevert.initialize(ZERO_ADDRESS, ZERO_ADDRESS)).to.be.reverted;
    });
  });
  describe('isGovernor', () => {
    it('success - correct values', async () => {
      expect(await treasury.isGovernor(governor)).to.be.equal(true);
      expect(await treasury.isGovernor(alice.address)).to.be.equal(false);
    });
  });
  describe('isGovernorOrGuardian', () => {
    it('success - correct values', async () => {
      expect(await treasury.isGovernorOrGuardian(governor)).to.be.equal(true);
      expect(await treasury.isGovernorOrGuardian(alice.address)).to.be.equal(false);
    });
  });
  describe('setSurplusForGovernance', () => {
    it('reverts - non governor', async () => {
      await expect(treasury.setSurplusForGovernance(parseAmount.gwei(0.5))).to.be.revertedWith('1');
    });
    it('reverts - too high amount', async () => {
      await expect(
        treasury.connect(impersonatedSigners[governor]).setSurplusForGovernance(parseAmount.gwei(2)),
      ).to.be.revertedWith('9');
    });
    it('success - value updated', async () => {
      const receipt = await (
        await treasury.connect(impersonatedSigners[governor]).setSurplusForGovernance(parseAmount.gwei(0.5))
      ).wait();
      expect(await treasury.surplusForGovernance()).to.be.equal(parseAmount.gwei(0.5));
      inReceipt(receipt, 'SurplusForGovernanceUpdated', {
        _surplusForGovernance: parseAmount.gwei(0.5),
      });
    });
  });
  describe('addMinter', () => {
    it('reverts - non governor', async () => {
      await expect(treasury.addMinter(alice.address)).to.be.revertedWith('1');
    });
    it('reverts - zero value', async () => {
      await expect(treasury.connect(impersonatedSigners[governor]).addMinter(ZERO_ADDRESS)).to.be.revertedWith('0');
    });
    it('success - minter added', async () => {
      await (await treasury.connect(impersonatedSigners[governor]).addMinter(alice.address)).wait();
      expect(await stablecoin.minters(alice.address)).to.be.true;
    });
  });
  describe('addVaultManager', () => {
    it('reverts - non governor', async () => {
      await expect(treasury.addMinter(alice.address)).to.be.revertedWith('1');
    });
    it('reverts - zero value', async () => {
      await expect(treasury.connect(impersonatedSigners[governor]).addMinter(ZERO_ADDRESS)).to.be.revertedWith('0');
    });
    it('success - minter added', async () => {
      await (await treasury.connect(impersonatedSigners[governor]).addMinter(alice.address)).wait();
      expect(await stablecoin.minters(alice.address)).to.be.true;
    });
  });
  describe('setSurplusManager', () => {
    it('reverts - non governor', async () => {
      await expect(treasury.setSurplusManager(alice.address)).to.be.revertedWith('1');
    });
    it('reverts - zero value', async () => {
      await expect(treasury.connect(impersonatedSigners[governor]).setSurplusManager(ZERO_ADDRESS)).to.be.revertedWith(
        '0',
      );
    });
    it('success - value updated', async () => {
      const receipt = await (
        await treasury.connect(impersonatedSigners[governor]).setSurplusManager(alice.address)
      ).wait();
      expect(await treasury.surplusManager()).to.be.equal(alice.address);
      inReceipt(receipt, 'SurplusManagerUpdated', {
        _surplusManager: alice.address,
      });
    });
  });
  describe('setCore', () => {
    it('reverts - non governor', async () => {
      await expect(treasury.setCore(alice.address)).to.be.revertedWith('1');
    });
    it('reverts - invalid core contract', async () => {
      const coreBorrowNew = (await new MockCoreBorrow__factory(deployer).deploy()) as MockCoreBorrow;
      await expect(treasury.connect(impersonatedSigners[governor]).setCore(coreBorrowNew.address)).to.be.revertedWith(
        '1',
      );
    });
    it('success - value updated', async () => {
      const coreBorrowNew = (await new MockCoreBorrow__factory(deployer).deploy()) as MockCoreBorrow;
      await coreBorrowNew.toggleGovernor(governor);

      const receipt = await (
        await treasury.connect(impersonatedSigners[governor]).setCore(coreBorrowNew.address)
      ).wait();
      inReceipt(receipt, 'CoreUpdated', {
        _core: coreBorrowNew.address,
      });
    });
  });
});
