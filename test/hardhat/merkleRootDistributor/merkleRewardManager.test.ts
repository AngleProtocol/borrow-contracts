import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BigNumber } from 'ethers';
import { parseEther } from 'ethers/lib/utils';
import { contract, ethers, web3 } from 'hardhat';
import { MerkleTree } from 'merkletreejs';

import {
  MerkleRewardManagerEthereum,
  MerkleRewardManagerEthereum__factory,
  MerkleRootDistributor,
  MerkleRootDistributor__factory,
  MockCoreBorrow,
  MockCoreBorrow__factory,
  MockToken,
  MockToken__factory,
  MockTreasury,
  MockTreasury__factory,
} from '../../../typechain';
import { parseAmount } from '../../../utils/bignumber';
import { expect } from '../utils/chai-setup';
import { inReceipt } from '../utils/expectEvent';
import { deployUpgradeable, ZERO_ADDRESS } from '../utils/helpers';

contract('MerkleRewardManager', () => {
  let deployer: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let governor: SignerWithAddress;
  let guardian: SignerWithAddress;
  let angle: MockToken;

  let distributor: MerkleRootDistributor;
  let manager: MerkleRewardManagerEthereum;
  let coreBorrow: MockCoreBorrow;
  let treasury: MockTreasury;

  beforeEach(async () => {
    [deployer, alice, bob, governor, guardian] = await ethers.getSigners();
    angle = (await new MockToken__factory(deployer).deploy('ANGLE', 'ANGLE', 18)) as MockToken;
    coreBorrow = (await new MockCoreBorrow__factory(deployer).deploy()) as MockCoreBorrow;
    await (await coreBorrow.toggleGuardian(guardian.address)).wait();
    await (await coreBorrow.toggleGovernor(governor.address)).wait();
    treasury = await new MockTreasury__factory(deployer).deploy(
      angle.address,
      governor.address,
      guardian.address,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
    );
    distributor = (await deployUpgradeable(new MerkleRootDistributor__factory(deployer))) as MerkleRootDistributor;
    await distributor.initialize(treasury.address);
    manager = (await deployUpgradeable(
      new MerkleRewardManagerEthereum__factory(deployer),
    )) as MerkleRewardManagerEthereum;
    await manager.initialize(coreBorrow.address, distributor.address, parseAmount.gwei('0.1'));
  });
  describe('initializer', () => {
    it('success - treasury', async () => {
      expect(await manager.merkleRootDistributor()).to.be.equal(distributor.address);
      expect(await manager.coreBorrow()).to.be.equal(coreBorrow.address);
      expect(await manager.fees()).to.be.equal(parseAmount.gwei('0.1'));
    });
    it('reverts - already initialized', async () => {
      await expect(
        manager.initialize(coreBorrow.address, distributor.address, parseAmount.gwei('0.1')),
      ).to.be.revertedWith('Initializable: contract is already initialized');
    });
    it('reverts - zero address', async () => {
      const managerRevert = (await deployUpgradeable(
        new MerkleRewardManagerEthereum__factory(deployer),
      )) as MerkleRewardManagerEthereum;
      await expect(
        managerRevert.initialize(ZERO_ADDRESS, distributor.address, parseAmount.gwei('0.1')),
      ).to.be.revertedWith('ZeroAddress');
      await expect(
        managerRevert.initialize(coreBorrow.address, ZERO_ADDRESS, parseAmount.gwei('0.1')),
      ).to.be.revertedWith('ZeroAddress');
      await expect(
        managerRevert.initialize(coreBorrow.address, distributor.address, parseAmount.gwei('1')),
      ).to.be.revertedWith('InvalidParam');
    });
  });
});
