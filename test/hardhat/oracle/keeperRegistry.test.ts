import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { contract, ethers } from 'hardhat';

import { KeeperRegistry, KeeperRegistry__factory, MockCoreBorrow, MockCoreBorrow__factory } from '../../../typechain';
import { expect } from '../utils/chai-setup';
import { deployUpgradeable } from '../utils/helpers';

contract('KeeperRegistry', () => {
  let deployer: SignerWithAddress, alice: SignerWithAddress, guardian: SignerWithAddress;

  let registery: KeeperRegistry;
  let coreBorrow: MockCoreBorrow;

  beforeEach(async () => {
    ({ deployer, alice, guardian } = await ethers.getNamedSigners());
    coreBorrow = (await new MockCoreBorrow__factory(deployer).deploy()) as MockCoreBorrow;
    await (await coreBorrow.toggleGuardian(guardian.address)).wait();

    registery = (await deployUpgradeable(new KeeperRegistry__factory(deployer))) as KeeperRegistry;
    await (await registery.initialize(coreBorrow.address)).wait();
  });

  describe('initialize', () => {
    it('success - variables correctly initialized', async () => {
      expect(await registery.coreBorrow()).to.be.equal(coreBorrow.address);
    });
    it('success - cannot be called again', async () => {
      await expect(registery.initialize(coreBorrow.address)).to.be.reverted;
    });
  });

  describe('toggleTrusted', () => {
    it('reverts - only governor or guardian', async () => {
      await expect(registery.connect(alice).toggleTrusted(alice.address)).to.be.reverted;
    });
    it('success - guardian', async () => {
      expect(await registery.trusted(alice.address)).to.be.equal(0);
      await (await registery.connect(guardian).toggleTrusted(alice.address)).wait();
      expect(await registery.trusted(alice.address)).to.be.equal(1);
      await (await registery.connect(guardian).toggleTrusted(alice.address)).wait();
      expect(await registery.trusted(alice.address)).to.be.equal(0);
    });
  });
});
