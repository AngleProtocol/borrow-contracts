import { ChainId, registry } from '@angleprotocol/sdk';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { Signer, utils } from 'ethers';
import { parseEther } from 'ethers/lib/utils';
import hre, { contract, ethers } from 'hardhat';

import { MockTokenPermit, SanTokenERC4626Adapter, SanTokenERC4626Adapter__factory } from '../../../typechain';
import { expect } from '../utils/chai-setup';
import { inIndirectReceipt, inReceipt } from '../utils/expectEvent';
import { deployUpgradeable, ZERO_ADDRESS } from '../utils/helpers';

contract('SanTokenERC4626Adapter', () => {
  let deployer: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  let adapter: SanTokenERC4626Adapter;
  let governor: string;
  let stableMaster: string;
  let poolManager: string;

  const impersonatedSigners: { [key: string]: Signer } = {};

  before(async () => {
    [deployer, alice, bob] = await ethers.getSigners();

    const collateral = registry(ChainId.MAINNET)?.agEUR?.collaterals?.USDC;
    poolManager = collateral?.PoolManager as string;
    stableMaster = registry(ChainId.MAINNET)?.agEUR?.StableMaster as string;
  });

  beforeEach(async () => {
    await hre.network.provider.request({
      method: 'hardhat_reset',
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.ETH_NODE_URI_MAINNET,
            // Changing Avalanche fork block breaks some tests
            blockNumber: 16576114,
          },
        },
      ],
    });
    adapter = (await deployUpgradeable(new SanTokenERC4626Adapter__factory(deployer))) as SanTokenERC4626Adapter;
    await adapter.initialize(stableMaster, poolManager);
  });

  describe('initializer', () => {
    it('success - stableMaster, name, symbol, treasury', async () => {
      expect(await adapter.name()).to.be.equal('Angle sanUSDC_EUR wrapper');
      expect(await adapter.symbol()).to.be.equal('ag-wrapper-sanUSDC_EUR');
      expect(await adapter.poolManager()).to.be.equal(poolManager);
      expect(await adapter.stableMaster()).to.be.equal(stableMaster);
    });
  });
});
