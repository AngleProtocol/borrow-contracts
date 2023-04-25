import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BigNumber } from 'ethers';
import { contract, ethers, network } from 'hardhat';

import { expect } from '../../test/hardhat/utils/chai-setup';
import { ZERO_ADDRESS } from '../../test/hardhat/utils/helpers';
import {
  MockTreasury,
  MockTreasury__factory,
  OracleBTCEURChainlink,
  OracleBTCEURChainlink__factory,
  OracleCBETHEURChainlink,
  OracleCBETHEURChainlink__factory,
  OracleETHEURChainlink,
  OracleETHEURChainlink__factory,
  OracleETHXAUChainlink,
  OracleETHXAUChainlink__factory,
  OracleLUSDEURChainlink,
  OracleLUSDEURChainlink__factory,
  OracleLUSDXAUChainlink,
  OracleLUSDXAUChainlink__factory,
  OracleUSDCXAUChainlink,
  OracleUSDCXAUChainlink__factory,
  OracleWSTETHEURChainlink,
  OracleWSTETHEURChainlink__factory,
  OracleWSTETHXAUChainlink,
  OracleWSTETHXAUChainlink__factory,
} from '../../typechain';

contract('Oracles Chainlink', () => {
  let deployer: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  let oracleWSTETH: OracleWSTETHEURChainlink;
  let oracleETH: OracleETHEURChainlink;
  let oracleBTC: OracleBTCEURChainlink;
  let oracleLUSD: OracleLUSDEURChainlink;
  let oracleCBETH: OracleCBETHEURChainlink;
  let oracleLUSDXAU: OracleLUSDXAUChainlink;
  let oracleETHXAU: OracleETHXAUChainlink;
  let oracleUSDCXAU: OracleUSDCXAUChainlink;
  let oracleWSTETHXAU: OracleWSTETHXAUChainlink;
  let stalePeriod: BigNumber;
  let treasury: MockTreasury;

  before(async () => {
    [deployer, alice, bob] = await ethers.getSigners();
    stalePeriod = BigNumber.from(86400 * 52);
    await network.provider.request({
      method: 'hardhat_reset',
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.ETH_NODE_URI_FORK,
            blockNumber: 16526566,
          },
        },
      ],
    });
    treasury = (await new MockTreasury__factory(deployer).deploy(
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
    )) as MockTreasury;

    oracleWSTETH = await new OracleWSTETHEURChainlink__factory(deployer).deploy(stalePeriod, treasury.address);
    oracleETH = await new OracleETHEURChainlink__factory(deployer).deploy(stalePeriod, treasury.address);
    oracleBTC = await new OracleBTCEURChainlink__factory(deployer).deploy(stalePeriod, treasury.address);
    oracleLUSD = await new OracleLUSDEURChainlink__factory(deployer).deploy(stalePeriod, treasury.address);
    oracleCBETH = await new OracleCBETHEURChainlink__factory(deployer).deploy(stalePeriod, treasury.address);
    oracleLUSDXAU = await new OracleLUSDXAUChainlink__factory(deployer).deploy(stalePeriod, treasury.address);
    oracleETHXAU = await new OracleETHXAUChainlink__factory(deployer).deploy(stalePeriod, treasury.address);
    oracleWSTETHXAU = await new OracleWSTETHXAUChainlink__factory(deployer).deploy(stalePeriod, treasury.address);
    oracleUSDCXAU = await new OracleUSDCXAUChainlink__factory(deployer).deploy(stalePeriod, treasury.address);
  });

  describe('Oracle wStETHEUR', () => {
    it('read', async () => {
      const receipt = await oracleWSTETH.read();
      const gas = await oracleWSTETH.estimateGas.read();
      console.log(gas.toString());
      console.log(receipt.toString());
    });
    it('initialization', async () => {
      expect(await oracleWSTETH.STETH()).to.be.equal('0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84');
      expect(await oracleWSTETH.stalePeriod()).to.be.equal(stalePeriod);
      expect(await oracleWSTETH.treasury()).to.be.equal(treasury.address);
    });
  });
  describe('Oracle ETHEUR', () => {
    it('read', async () => {
      const receipt = await oracleETH.read();
      const gas = await oracleETH.estimateGas.read();
      console.log(gas.toString());
      console.log(receipt.toString());
    });
    it('initialization', async () => {
      expect(await oracleETH.stalePeriod()).to.be.equal(stalePeriod);
      expect(await oracleETH.treasury()).to.be.equal(treasury.address);
    });
  });
  describe('Oracle BTCEUR', () => {
    it('read', async () => {
      const receipt = await oracleBTC.read();
      const gas = await oracleBTC.estimateGas.read();
      console.log(gas.toString());
      console.log(receipt.toString());
    });
    it('initialization', async () => {
      expect(await oracleBTC.stalePeriod()).to.be.equal(stalePeriod);
      expect(await oracleBTC.treasury()).to.be.equal(treasury.address);
    });
  });
  describe('Oracle LUSDEUR', () => {
    it('read', async () => {
      const receipt = await oracleLUSD.read();
      const gas = await oracleLUSD.estimateGas.read();
      console.log(gas.toString());
      console.log(receipt.toString());
    });
    it('initialization', async () => {
      expect(await oracleLUSD.stalePeriod()).to.be.equal(stalePeriod);
      expect(await oracleLUSD.treasury()).to.be.equal(treasury.address);
    });
  });
  describe('Oracle CBETHEUR', () => {
    it('read', async () => {
      const receipt = await oracleCBETH.read();
      const gas = await oracleCBETH.estimateGas.read();
      console.log(gas.toString());
      console.log(receipt.toString());
    });
    it('initialization', async () => {
      expect(await oracleCBETH.stalePeriod()).to.be.equal(stalePeriod);
      expect(await oracleCBETH.treasury()).to.be.equal(treasury.address);
    });
  });

  describe('Oracle LUSDXAU', () => {
    it('read', async () => {
      const receipt = await oracleLUSDXAU.read();
      const gas = await oracleLUSDXAU.estimateGas.read();
      console.log(gas.toString());
      console.log(receipt.toString());
    });
    it('initialization', async () => {
      expect(await oracleLUSDXAU.stalePeriod()).to.be.equal(stalePeriod);
      expect(await oracleLUSDXAU.treasury()).to.be.equal(treasury.address);
    });
  });
  describe('Oracle ETHXAU', () => {
    it('read', async () => {
      const receipt = await oracleETHXAU.read();
      const gas = await oracleETHXAU.estimateGas.read();
      console.log(gas.toString());
      console.log(receipt.toString());
    });
    it('initialization', async () => {
      expect(await oracleETHXAU.stalePeriod()).to.be.equal(stalePeriod);
      expect(await oracleETHXAU.treasury()).to.be.equal(treasury.address);
    });
  });
  describe('Oracle WSTETHXAU', () => {
    it('read', async () => {
      const receipt = await oracleWSTETHXAU.read();
      const gas = await oracleWSTETHXAU.estimateGas.read();
      console.log(gas.toString());
      console.log(receipt.toString());
    });
    it('initialization', async () => {
      expect(await oracleWSTETHXAU.stalePeriod()).to.be.equal(stalePeriod);
      expect(await oracleWSTETHXAU.treasury()).to.be.equal(treasury.address);
    });
  });
  describe('Oracle USDCXAU', () => {
    it('read', async () => {
      const receipt = await oracleUSDCXAU.read();
      const gas = await oracleUSDCXAU.estimateGas.read();
      console.log(gas.toString());
      console.log(receipt.toString());
    });
    it('initialization', async () => {
      expect(await oracleUSDCXAU.stalePeriod()).to.be.equal(stalePeriod);
      expect(await oracleUSDCXAU.treasury()).to.be.equal(treasury.address);
    });
  });
});
