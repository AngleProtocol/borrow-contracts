import { CONTRACTS_ADDRESSES } from '@angleprotocol/sdk';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { Signer } from 'ethers';
import { parseEther } from 'ethers/lib/utils';
import hre, { contract, ethers } from 'hardhat';

import { AgToken, AgToken__factory, MockStableMaster, MockStableMaster__factory } from '../../typechain';
import { expect } from '../utils/chai-setup';
import { deployUpgradeable } from '../utils/helpers';

contract('AgToken', () => {
  let deployer: SignerWithAddress;
  let user: SignerWithAddress;

  let agToken: AgToken;
  let stableMaster: MockStableMaster;

  const impersonatedSigners: { [key: string]: Signer } = {};

  before(async () => {
    [deployer, user] = await ethers.getSigners();
    // add any addresses you want to impersonate here
    const impersonatedAddresses = [CONTRACTS_ADDRESSES[1].Governor!];

    for (const address of impersonatedAddresses) {
      await hre.network.provider.request({
        method: 'hardhat_impersonateAccount',
        params: [address],
      });

      impersonatedSigners[address] = await ethers.getSigner(address);
    }
  });

  beforeEach(async () => {
    // If the forked-network state needs to be reset between each test, run this
    // await network.provider.request({method: 'hardhat_reset', params: []});

    // To deploy a contract, import and use the contract factory specific to that contract

    stableMaster = (await new MockStableMaster__factory(deployer).deploy()) as MockStableMaster;

    // Example of upgradeable deployment - Default signer will be user
    agToken = (await deployUpgradeable(new AgToken__factory(deployer))) as AgToken;

    await agToken.initialize('agEUR', 'agEUR', stableMaster.address);
  });

  // Try and do as much deployment in beforeEach, and as much testing in the actual functions
  describe('initializer', () => {
    it('success - stableMaster', async () => {
      expect(await agToken.stableMaster()).to.be.equal(stableMaster.address);
    });
    it('success - balanceOf', async () => {
      expect(await agToken.balanceOf(user.address)).to.be.equal(0);
    });
    it('success - mint', async () => {
      await stableMaster.mint(agToken.address, user.address, parseEther('1'));
      expect(await agToken.balanceOf(user.address)).to.be.equal(parseEther('1'));
    });
  });
});
