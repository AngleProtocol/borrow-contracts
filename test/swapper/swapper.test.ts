import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BigNumber, BigNumberish } from 'ethers';
import { parseEther, parseUnits } from 'ethers/lib/utils';
import { contract, ethers, web3 } from 'hardhat';

import {
  MockCoreBorrow,
  MockCoreBorrow__factory,
  Swapper,
  Swapper__factory,
  MockRouter,
  MockRouter__factory,
} from '../../typechain';
import { parseAmount } from '../../utils/bignumber';
import { expect } from '../utils/chai-setup';
import { inReceipt } from '../utils/expectEvent';
import { time, ZERO_ADDRESS } from '../utils/helpers';

contract('Settlement', () => {
  let deployer: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  let swapper: Swapper;
  let router: MockRouter;
  let core: MockCoreBorrow;

  beforeEach(async () => {
    [deployer, alice, bob] = await ethers.getSigners();
    core = (await new MockCoreBorrow__factory(deployer).deploy()) as MockCoreBorrow;
    router = (await new MockRouter__factory(deployer).deploy()) as MockRouter;
    router.setMultipliers(parseUnits('1', 9), parseUnits('1', 9));
    swapper = (await new Swapper__factory(deployer).deploy(
      core.address,
      router.address,
      router.address,
      router.address,
      router.address,
    )) as Swapper;
  });

  describe('constructor', () => {
    it('success - contract initialized', async () => {
      expect(await swapper.core()).to.be.equal(core.address);
      expect(await swapper.angleRouter()).to.be.equal(router.address);
      expect(await swapper.wStETH()).to.be.equal(router.address);
      expect(await swapper.oneInch()).to.be.equal(router.address);
      expect(await swapper.uniV3Router()).to.be.equal(router.address);
    });
    it('reverts - zero address', async () => {
      await expect(
        new Swapper__factory(deployer).deploy(
          ZERO_ADDRESS,
          router.address,
          router.address,
          router.address,
          router.address,
        ),
      ).to.be.revertedWith('0');
      await expect(
        new Swapper__factory(deployer).deploy(
          core.address,
          ZERO_ADDRESS,
          router.address,
          router.address,
          router.address,
        ),
      ).to.be.reverted;
      await expect(
        new Swapper__factory(deployer).deploy(
          core.address,
          router.address,
          ZERO_ADDRESS,
          router.address,
          router.address,
        ),
      ).to.be.revertedWith('0');
      await expect(
        new Swapper__factory(deployer).deploy(
          core.address,
          router.address,
          router.address,
          ZERO_ADDRESS,
          router.address,
        ),
      ).to.be.revertedWith('0');
      await expect(
        new Swapper__factory(deployer).deploy(
          core.address,
          router.address,
          router.address,
          router.address,
          ZERO_ADDRESS,
        ),
      ).to.be.revertedWith('0');
    });
  });
});
