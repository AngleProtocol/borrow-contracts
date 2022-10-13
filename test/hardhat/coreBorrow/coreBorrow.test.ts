import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { Signer } from 'ethers';
import hre, { contract, ethers, web3 } from 'hardhat';

import {
  CoreBorrow,
  CoreBorrow__factory,
  MockFlashLoanModule,
  MockFlashLoanModule__factory,
  MockTreasury,
  MockTreasury__factory,
} from '../../../typechain';
import { expect } from '../utils/chai-setup';
import { inReceipt } from '../utils/expectEvent';
import { deployUpgradeable, ZERO_ADDRESS } from '../utils/helpers';

contract('CoreBorrow', () => {
  let deployer: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  let coreBorrow: CoreBorrow;
  let coreBorrowRevert: CoreBorrow;
  let flashAngle: MockFlashLoanModule;
  let governor: string;
  let guardian: string;
  let treasury: MockTreasury;
  let guardianRole: string;
  let governorRole: string;
  let flashloanerTreasuryRole: string;
  let governorError: string;

  const impersonatedSigners: { [key: string]: Signer } = {};

  before(async () => {
    [deployer, alice, bob] = await ethers.getSigners();
    // add any addresses you want to impersonate here
    governor = '0xdC4e6DFe07EFCa50a197DF15D9200883eF4Eb1c8';
    guardian = '0x0C2553e4B9dFA9f83b1A6D3EAB96c4bAaB42d430';
    const impersonatedAddresses = [governor, guardian];

    for (const address of impersonatedAddresses) {
      await hre.network.provider.request({
        method: 'hardhat_impersonateAccount',
        params: [address],
      });
      await hre.network.provider.send('hardhat_setBalance', [address, '0x10000000000000000000000000000']);
      impersonatedSigners[address] = await ethers.getSigner(address);
    }
    guardianRole = web3.utils.keccak256('GUARDIAN_ROLE');
    governorRole = web3.utils.keccak256('GOVERNOR_ROLE');
    flashloanerTreasuryRole = web3.utils.keccak256('FLASHLOANER_TREASURY_ROLE');
    governorError = `AccessControl: account ${alice.address.toLowerCase()} is missing role ${governorRole}`;
  });

  beforeEach(async () => {
    coreBorrow = (await deployUpgradeable(new CoreBorrow__factory(deployer))) as CoreBorrow;

    treasury = (await new MockTreasury__factory(deployer).deploy(
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
    )) as MockTreasury;

    flashAngle = (await new MockFlashLoanModule__factory(deployer).deploy(coreBorrow.address)) as MockFlashLoanModule;
    treasury = (await new MockTreasury__factory(deployer).deploy(
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
    )) as MockTreasury;
    await coreBorrow.initialize(governor, guardian);
  });

  describe('initializer', () => {
    it('success - Access Control', async () => {
      expect(await coreBorrow.isGovernor(governor)).to.be.equal(true);
      expect(await coreBorrow.isGovernor(guardian)).to.be.equal(false);
      expect(await coreBorrow.isGovernorOrGuardian(guardian)).to.be.equal(true);
      expect(await coreBorrow.isGovernorOrGuardian(governor)).to.be.equal(true);
      expect(await coreBorrow.isFlashLoanerTreasury(governor)).to.be.equal(false);
      expect(await coreBorrow.isFlashLoanerTreasury(guardian)).to.be.equal(false);
      expect(await coreBorrow.getRoleAdmin(guardianRole)).to.be.equal(governorRole);
      expect(await coreBorrow.getRoleAdmin(governorRole)).to.be.equal(governorRole);
      expect(await coreBorrow.getRoleAdmin(flashloanerTreasuryRole)).to.be.equal(governorRole);
      expect(await coreBorrow.hasRole(guardianRole, guardian)).to.be.equal(true);
      expect(await coreBorrow.hasRole(guardianRole, governor)).to.be.equal(true);
      expect(await coreBorrow.hasRole(governorRole, governor)).to.be.equal(true);
      expect(await coreBorrow.hasRole(flashloanerTreasuryRole, governor)).to.be.equal(false);
      expect(await coreBorrow.flashLoanModule()).to.be.equal(ZERO_ADDRESS);
    });
    it('reverts - already initialized', async () => {
      await expect(coreBorrow.initialize(governor, guardian)).to.be.revertedWith(
        'Initializable: contract is already initialized',
      );
    });
    it('reverts - invalid governor/guardian', async () => {
      coreBorrowRevert = (await deployUpgradeable(new CoreBorrow__factory(deployer))) as CoreBorrow;
      await expect(coreBorrowRevert.initialize(governor, governor)).to.be.revertedWith(
        'IncompatibleGovernorAndGuardian',
      );
      await expect(coreBorrowRevert.initialize(governor, ZERO_ADDRESS)).to.be.reverted;
      await expect(coreBorrowRevert.initialize(ZERO_ADDRESS, guardian)).to.be.reverted;
    });
  });
  describe('addGovernor', () => {
    it('reverts - nonGovernor', async () => {
      await expect(coreBorrow.connect(alice.address).addGovernor(alice.address)).to.be.revertedWith(governorError);
    });
    it('success - governor added', async () => {
      await coreBorrow.connect(impersonatedSigners[governor]).addGovernor(alice.address);
      expect(await coreBorrow.isGovernor(alice.address)).to.be.true;
      expect(await coreBorrow.isGovernorOrGuardian(alice.address)).to.be.true;
      expect(await coreBorrow.hasRole(guardianRole, alice.address)).to.be.equal(true);
      expect(await coreBorrow.hasRole(governorRole, alice.address)).to.be.equal(true);
    });
    it('success - new governor can add other governors', async () => {
      await coreBorrow.connect(impersonatedSigners[governor]).addGovernor(alice.address);
      await coreBorrow.connect(alice).addGovernor(guardian);
      expect(await coreBorrow.isGovernor(guardian)).to.be.true;
      expect(await coreBorrow.hasRole(guardianRole, alice.address)).to.be.equal(true);
    });
  });
  describe('removeGovernor', () => {
    it('reverts - not enough governors left', async () => {
      await expect(coreBorrow.connect(impersonatedSigners[governor]).removeGovernor(governor)).to.be.revertedWith(
        'NotEnoughGovernorsLeft',
      );
    });
    it('reverts - nonGovernor', async () => {
      await coreBorrow.connect(impersonatedSigners[governor]).addGovernor(bob.address);
      await expect(coreBorrow.connect(alice.address).removeGovernor(alice.address)).to.be.revertedWith(governorError);
    });
    it('success - governor removed (after having been added)', async () => {
      await coreBorrow.connect(impersonatedSigners[governor]).addGovernor(alice.address);
      await coreBorrow.connect(impersonatedSigners[governor]).removeGovernor(alice.address);
      expect(await coreBorrow.isGovernor(alice.address)).to.be.false;
      expect(await coreBorrow.isGovernorOrGuardian(alice.address)).to.be.false;
      expect(await coreBorrow.hasRole(guardianRole, alice.address)).to.be.equal(false);
      expect(await coreBorrow.hasRole(governorRole, alice.address)).to.be.equal(false);
    });
    it('success - governor removed (after having been added) and requested by alice', async () => {
      await coreBorrow.connect(impersonatedSigners[governor]).addGovernor(alice.address);
      await coreBorrow.connect(alice).removeGovernor(alice.address);
      expect(await coreBorrow.isGovernor(alice.address)).to.be.false;
      expect(await coreBorrow.isGovernorOrGuardian(alice.address)).to.be.false;
      expect(await coreBorrow.hasRole(guardianRole, alice.address)).to.be.equal(false);
      expect(await coreBorrow.hasRole(governorRole, alice.address)).to.be.equal(false);
    });
  });
  describe('setFlashLoanModule', () => {
    it('reverts - non governor', async () => {
      await expect(coreBorrow.connect(alice.address).setFlashLoanModule(governor)).to.be.revertedWith(governorError);
    });
    it('success - zero address', async () => {
      const receipt = await (
        await coreBorrow.connect(impersonatedSigners[governor]).setFlashLoanModule(ZERO_ADDRESS)
      ).wait();
      inReceipt(receipt, 'FlashLoanModuleUpdated', {
        _flashloanModule: ZERO_ADDRESS,
      });
    });
    it('success - non zero address and no treasury', async () => {
      const receipt = await (
        await coreBorrow.connect(impersonatedSigners[governor]).setFlashLoanModule(flashAngle.address)
      ).wait();
      inReceipt(receipt, 'FlashLoanModuleUpdated', {
        _flashloanModule: flashAngle.address,
      });
      expect(await coreBorrow.flashLoanModule()).to.be.equal(flashAngle.address);
    });
    it('reverts - non zero address but wrong core', async () => {
      flashAngle = (await new MockFlashLoanModule__factory(deployer).deploy(governor)) as MockFlashLoanModule;
      await expect(
        coreBorrow.connect(impersonatedSigners[governor]).setFlashLoanModule(flashAngle.address),
      ).to.be.revertedWith('InvalidCore');
    });
    it('success - non zero address and treasury contract added', async () => {
      await coreBorrow.connect(impersonatedSigners[governor]).addFlashLoanerTreasuryRole(treasury.address);
      const receipt = await (
        await coreBorrow.connect(impersonatedSigners[governor]).setFlashLoanModule(flashAngle.address)
      ).wait();
      inReceipt(receipt, 'FlashLoanModuleUpdated', {
        _flashloanModule: flashAngle.address,
      });
      expect(await coreBorrow.flashLoanModule()).to.be.equal(flashAngle.address);
      expect(await treasury.flashLoanModule()).to.be.equal(flashAngle.address);
    });
  });
  describe('addFlashLoanerTreasuryRole', () => {
    it('reverts - nonGovernor', async () => {
      await expect(coreBorrow.connect(alice).addFlashLoanerTreasuryRole(treasury.address)).to.be.revertedWith(
        governorError,
      );
    });
    it('success - zero flash loan module', async () => {
      await coreBorrow.connect(impersonatedSigners[governor]).addFlashLoanerTreasuryRole(treasury.address);
      expect(await coreBorrow.hasRole(flashloanerTreasuryRole, treasury.address)).to.be.equal(true);
      expect(await coreBorrow.isFlashLoanerTreasury(treasury.address)).to.be.equal(true);
    });
    it('success - with a flash loan module', async () => {
      await (await coreBorrow.connect(impersonatedSigners[governor]).setFlashLoanModule(flashAngle.address)).wait();
      await coreBorrow.connect(impersonatedSigners[governor]).addFlashLoanerTreasuryRole(treasury.address);
      expect(await coreBorrow.hasRole(flashloanerTreasuryRole, treasury.address)).to.be.equal(true);
      expect(await coreBorrow.isFlashLoanerTreasury(treasury.address)).to.be.equal(true);
      expect(await coreBorrow.flashLoanModule()).to.be.equal(flashAngle.address);
      expect(await treasury.flashLoanModule()).to.be.equal(flashAngle.address);
      expect(await flashAngle.stablecoinsSupported(treasury.address)).to.be.equal(true);
    });
  });
  describe('removeFlashLoanerTreasuryRole', () => {
    it('reverts - nonGovernor', async () => {
      await expect(coreBorrow.connect(alice).removeFlashLoanerTreasuryRole(treasury.address)).to.be.revertedWith(
        governorError,
      );
    });
    it('success - zero flash loan module', async () => {
      await coreBorrow.connect(impersonatedSigners[governor]).addFlashLoanerTreasuryRole(treasury.address);
      await coreBorrow.connect(impersonatedSigners[governor]).removeFlashLoanerTreasuryRole(treasury.address);
      expect(await coreBorrow.hasRole(flashloanerTreasuryRole, treasury.address)).to.be.equal(false);
      expect(await coreBorrow.isFlashLoanerTreasury(treasury.address)).to.be.equal(false);
    });
    it('success - with a flash loan module', async () => {
      await (await coreBorrow.connect(impersonatedSigners[governor]).setFlashLoanModule(flashAngle.address)).wait();
      await coreBorrow.connect(impersonatedSigners[governor]).addFlashLoanerTreasuryRole(treasury.address);
      await coreBorrow.connect(impersonatedSigners[governor]).removeFlashLoanerTreasuryRole(treasury.address);
      expect(await coreBorrow.hasRole(flashloanerTreasuryRole, treasury.address)).to.be.equal(false);
      expect(await coreBorrow.isFlashLoanerTreasury(treasury.address)).to.be.equal(false);
      expect(await coreBorrow.flashLoanModule()).to.be.equal(flashAngle.address);
      expect(await treasury.flashLoanModule()).to.be.equal(ZERO_ADDRESS);
      expect(await flashAngle.stablecoinsSupported(treasury.address)).to.be.equal(false);
    });
  });
  describe('setCore', () => {
    it('reverts - nonGovernor', async () => {
      await expect(coreBorrow.connect(alice).setCore(treasury.address)).to.be.revertedWith(governorError);
    });
    it('success - good governor roles and no flashLoanModule', async () => {
      coreBorrowRevert = (await deployUpgradeable(new CoreBorrow__factory(deployer))) as CoreBorrow;
      await coreBorrowRevert.initialize(governor, guardian);
      const receipt = await (
        await coreBorrow.connect(impersonatedSigners[governor]).setCore(coreBorrowRevert.address)
      ).wait();
      inReceipt(receipt, 'CoreUpdated', {
        _core: coreBorrowRevert.address,
      });
    });
    it('success - good governor roles and flashLoanModule', async () => {
      coreBorrowRevert = (await deployUpgradeable(new CoreBorrow__factory(deployer))) as CoreBorrow;
      await (await coreBorrow.connect(impersonatedSigners[governor]).setFlashLoanModule(flashAngle.address)).wait();
      await coreBorrowRevert.initialize(governor, guardian);
      const receipt = await (
        await coreBorrow.connect(impersonatedSigners[governor]).setCore(coreBorrowRevert.address)
      ).wait();
      inReceipt(receipt, 'CoreUpdated', {
        _core: coreBorrowRevert.address,
      });
      expect(await flashAngle.core()).to.be.equal(coreBorrowRevert.address);
    });
    it('reverts - wrong governor roles', async () => {
      coreBorrowRevert = (await deployUpgradeable(new CoreBorrow__factory(deployer))) as CoreBorrow;
      await coreBorrowRevert.initialize(guardian, alice.address);
      await expect(
        coreBorrow.connect(impersonatedSigners[governor]).setCore(coreBorrowRevert.address),
      ).to.be.rejectedWith('InvalidCore');
    });
  });
  describe('grantGuardianRole', () => {
    it('reverts - nonGuardian', async () => {
      await expect(coreBorrow.connect(alice).grantRole(guardianRole, alice.address)).to.be.revertedWith(governorError);
    });
    it('success - guardianRole updated', async () => {
      await coreBorrow.connect(impersonatedSigners[governor]).grantRole(guardianRole, alice.address);
      expect(await coreBorrow.hasRole(guardianRole, alice.address)).to.be.true;
      expect(await coreBorrow.isGovernorOrGuardian(alice.address)).to.be.true;
    });
  });
  describe('revokeGuardianRole', () => {
    it('reverts - nonGuardian', async () => {
      await expect(coreBorrow.connect(alice).revokeRole(guardianRole, alice.address)).to.be.revertedWith(governorError);
    });
    it('success - guardianRole updated', async () => {
      await coreBorrow.connect(impersonatedSigners[governor]).revokeRole(guardianRole, guardian);
      expect(await coreBorrow.hasRole(guardianRole, guardian)).to.be.equal(false);
      expect(await coreBorrow.isGovernorOrGuardian(guardian)).to.be.equal(false);
    });
  });
});
