import { ethers } from 'hardhat';
import { BigNumber } from 'ethers';
import { parseAmount, gwei, mwei } from '../../utils/bignumber';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { utils, Wallet, constants } from 'ethers';
import { expect } from '../utils/chai-setup';
import { initAgTokenWithMock } from '../utils/helpers';
import { AgToken, MockStableMaster } from '../../typechain';

describe('AgToken', () => {
  let governor: SignerWithAddress, user: SignerWithAddress;
  let agToken: AgToken;
  let stableMaster: MockStableMaster;

  before(async () => {
    [governor, user] = await ethers.getSigners();
    ({ agToken, stableMaster } = await initAgTokenWithMock(governor, 'agEUR'));
  });
  describe('initializer', () => {
    it('success - stableMaster', async () => {
      expect(await agToken.stableMaster()).to.be.equal(stableMaster.address);
    });
  });
});
