import { ChainId, registry } from '@angleprotocol/sdk';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import hre, { contract, ethers } from 'hardhat';

import {
  SanDAIEURERC4626Adapter,
  SanDAIEURERC4626Adapter__factory,
  SanDAIEURERC4626AdapterStakable,
  SanDAIEURERC4626AdapterStakable__factory,
  SanFRAXEURERC4626Adapter,
  SanFRAXEURERC4626Adapter__factory,
  SanFRAXEURERC4626AdapterStakable,
  SanFRAXEURERC4626AdapterStakable__factory,
} from '../../../typechain';
import { expect } from '../utils/chai-setup';
import { deployUpgradeable, ZERO_ADDRESS } from '../utils/helpers';

contract('SanTokenERC4626Adapter - Implementations', () => {
  let deployer: SignerWithAddress;

  let dai: SanDAIEURERC4626Adapter;
  let daiStk: SanDAIEURERC4626AdapterStakable;
  let frax: SanFRAXEURERC4626Adapter;
  let fraxStk: SanFRAXEURERC4626AdapterStakable;

  let stableMaster: string;

  before(async () => {
    [deployer] = await ethers.getSigners();

    stableMaster = registry(ChainId.MAINNET)?.agEUR?.StableMaster as string;
  });

  beforeEach(async () => {
    await hre.network.provider.request({
      method: 'hardhat_reset',
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.ETH_NODE_URI_MAINNET,

            blockNumber: 16033678,
          },
        },
      ],
    });
    dai = (await deployUpgradeable(new SanDAIEURERC4626Adapter__factory(deployer))) as SanDAIEURERC4626Adapter;
    daiStk = (await deployUpgradeable(
      new SanDAIEURERC4626AdapterStakable__factory(deployer),
    )) as SanDAIEURERC4626AdapterStakable;
    frax = (await deployUpgradeable(new SanFRAXEURERC4626Adapter__factory(deployer))) as SanFRAXEURERC4626Adapter;
    fraxStk = (await deployUpgradeable(
      new SanFRAXEURERC4626AdapterStakable__factory(deployer),
    )) as SanFRAXEURERC4626AdapterStakable;
  });
  describe('initializer', () => {
    it('success', async () => {
      expect(await dai.stableMaster()).to.be.equal(stableMaster);
      expect(await daiStk.stableMaster()).to.be.equal(stableMaster);
      expect(await frax.stableMaster()).to.be.equal(stableMaster);
      expect(await fraxStk.stableMaster()).to.be.equal(stableMaster);

      const daiCollat = registry(ChainId.MAINNET)?.agEUR?.collaterals?.DAI;
      expect(await dai.poolManager()).to.be.equal(daiCollat?.PoolManager);
      expect(await daiStk.poolManager()).to.be.equal(daiCollat?.PoolManager);
      expect(await dai.sanToken()).to.be.equal(daiCollat?.SanToken);
      expect(await daiStk.sanToken()).to.be.equal(daiCollat?.SanToken);
      expect(await dai.gauge()).to.be.equal(ZERO_ADDRESS);
      expect(await daiStk.gauge()).to.be.equal(daiCollat?.LiquidityGauge);
      expect(await dai.asset()).to.be.equal('0x6B175474E89094C44Da98b954EedeAC495271d0F');
      expect(await daiStk.asset()).to.be.equal('0x6B175474E89094C44Da98b954EedeAC495271d0F');

      const fraxCollat = registry(ChainId.MAINNET)?.agEUR?.collaterals?.FRAX;
      expect(await frax.poolManager()).to.be.equal(fraxCollat?.PoolManager);
      expect(await fraxStk.poolManager()).to.be.equal(fraxCollat?.PoolManager);
      expect(await frax.sanToken()).to.be.equal(fraxCollat?.SanToken);
      expect(await fraxStk.sanToken()).to.be.equal(fraxCollat?.SanToken);
      expect(await frax.gauge()).to.be.equal(ZERO_ADDRESS);
      expect(await fraxStk.gauge()).to.be.equal(fraxCollat?.LiquidityGauge);
      expect(await frax.asset()).to.be.equal('0x853d955aCEf822Db058eb8505911ED77F175b99e');
      expect(await fraxStk.asset()).to.be.equal('0x853d955aCEf822Db058eb8505911ED77F175b99e');
    });
  });
});
