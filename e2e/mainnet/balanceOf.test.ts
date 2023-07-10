import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BigNumber } from 'ethers';
import { contract, ethers, network } from 'hardhat';

import { expect } from '../../test/hardhat/utils/chai-setup';
import { ZERO_ADDRESS } from '../../test/hardhat/utils/helpers';
import { ERC20, ERC20__factory } from '../../typechain';

contract('Balance', () => {
  let deployer: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  let addressCheck: string;

  let token: ERC20;

  before(async () => {
    [deployer, alice, bob] = await ethers.getSigners();
    await network.provider.request({
      method: 'hardhat_reset',
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.ETH_NODE_URI_FORK,
            blockNumber: 17411984,
          },
        },
      ],
    });
    token = new ethers.Contract(
      '0x857E0B2eD0E82D5cDEB015E77ebB873C47F99575',
      ERC20__factory.createInterface(),
      deployer,
    ) as ERC20;
    addressCheck = '0xD13F8C25CceD32cdfA79EB5eD654Ce3e484dCAF5';
  });

  describe('balanceOf', () => {
    it('read', async () => {
      const balance = await token.balanceOf(addressCheck);
      console.log(balance.toString());
    });
  });
});
