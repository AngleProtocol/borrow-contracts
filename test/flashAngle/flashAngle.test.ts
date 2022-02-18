import { CONTRACTS_ADDRESSES } from '@angleprotocol/sdk';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BigNumber, Signer, utils } from 'ethers';
import { parseEther } from 'ethers/lib/utils';
import hre, { contract, ethers, web3 } from 'hardhat';
import { Address } from 'hardhat-deploy/dist/types';
import { inReceipt, inIndirectReceipt } from '../utils/expectEvent';

import {
  FlashAngle,
  FlashAngle__factory,
  MockTreasury,
  MockTreasury__factory,
  MockCoreBorrow,
  MockCoreBorrow__factory,
  MockFlashLoanModule__factory,
} from '../../typechain';
import { expect } from '../utils/chai-setup';
import { deployUpgradeable, ZERO_ADDRESS } from '../utils/helpers';

contract('FlashAngle', () => {
  let deployer: SignerWithAddress;
  let user: SignerWithAddress;
  let user2: SignerWithAddress;

  let flashAngle: FlashAngle;
  let coreBorrow: MockCoreBorrow;
  let treasury: MockTreasury;
  let governor: string;
  let guardian: string;

  const impersonatedSigners: { [key: string]: Signer } = {};

  before(async () => {
    [deployer, user, user2] = await ethers.getSigners();
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
  });

  beforeEach(async () => {
    coreBorrow = (await new MockCoreBorrow__factory(deployer).deploy()) as MockCoreBorrow;
    treasury = (await new MockTreasury__factory(deployer).deploy(
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
    )) as MockTreasury;
    flashAngle = (await deployUpgradeable(new MockFlashLoanModule__factory(deployer))) as FlashAngle;
    await flashAngle.initialize(coreBorrow.address);
  });

  describe('initializer', () => {
    it('success - core initialized', async () => {
      expect(await flashAngle.core()).to.be.equal(coreBorrow.address);
    });
    it('reverts - already initialized', async () => {
      await expect(flashAngle.initialize(governor)).to.be.revertedWith(
        'Initializable: contract is already initialized',
      );
    });
    it('reverts - zero address', async () => {
      flashAngle = (await deployUpgradeable(new MockFlashLoanModule__factory(deployer))) as FlashAngle;
      await expect(flashAngle.initialize(ZERO_ADDRESS)).to.be.reverted;
    });
  });
});
