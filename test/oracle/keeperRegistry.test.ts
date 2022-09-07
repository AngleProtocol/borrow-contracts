import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BigNumber, utils } from 'ethers';
import { contract, ethers } from 'hardhat';

import { KeeperRegistry, KeeperRegistry__factory, MockTreasury, MockTreasury__factory } from '../../typechain';
import { expect } from '../utils/chai-setup';
import { inIndirectReceipt } from '../utils/expectEvent';
import { deployUpgradeable, ZERO_ADDRESS } from '../utils/helpers';

contract('OracleChainlinkMulti', () => {
  let deployer: SignerWithAddress, alice: SignerWithAddress, governor: SignerWithAddress, guardian: SignerWithAddress;

  let registery: KeeperRegistry;
  let treasury: MockTreasury;

  beforeEach(async () => {
    ({ deployer, alice, governor, guardian } = await ethers.getNamedSigners());
    treasury = (await new MockTreasury__factory(deployer).deploy(
      ZERO_ADDRESS,
      governor.address,
      guardian.address,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
    )) as MockTreasury;

    registery = (await deployUpgradeable(new KeeperRegistry__factory(deployer))) as KeeperRegistry;
    await (await registery.initialize(treasury.address)).wait();
  });

  describe('initialize', () => {
    it('success - variables correctly initialized', async () => {
      expect(await registery.treasury()).to.be.equal(treasury.address);
    });
    it('success - cannot be called again', async () => {
      await expect(registery.initialize(treasury.address)).to.be.reverted;
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
    it('success - governor', async () => {
      expect(await registery.trusted(alice.address)).to.be.equal(0);
      await (await registery.connect(governor).toggleTrusted(alice.address)).wait();
      expect(await registery.trusted(alice.address)).to.be.equal(1);
      const receipt = await (await registery.connect(governor).toggleTrusted(alice.address)).wait();
      inIndirectReceipt(
        receipt,
        new utils.Interface(['event TrustedToggled(address indexed wallet, bool trust)']),
        'TrustedToggled',
        {
          wallet: alice.address,
          trust: false,
        },
      );
      expect(await registery.trusted(alice.address)).to.be.equal(0);
    });
  });
});
