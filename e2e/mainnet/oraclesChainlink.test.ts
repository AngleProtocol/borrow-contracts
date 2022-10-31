import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BigNumber, Signer, utils } from 'ethers';
import { parseEther, parseUnits } from 'ethers/lib/utils';
import hre, { contract, ethers } from 'hardhat';

import { expect } from '../../test/hardhat/utils/chai-setup';
import { deployUpgradeable, ZERO_ADDRESS } from '../../test/hardhat/utils/helpers';
import {
  MockTreasury,
  MockTreasury__factory,
  OracleBTCEURChainlink,
  OracleBTCEURChainlink__factory,
  OracleETHEURChainlink,
  OracleETHEURChainlink__factory,
  OracleFRAXBPEURChainlink,
  OracleFRAXBPEURChainlink__factory,
  OracleLUSDEURChainlink,
  OracleLUSDEURChainlink__factory,
  OracleTriCrypto2EURChainlink,
  OracleTriCrypto2EURChainlink__factory,
  OracleWSTETHEURChainlink,
  OracleWSTETHEURChainlink__factory,
} from '../../typechain';

contract('Oracles Chainlink', () => {
  let deployer: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  let oracleWSTETH: OracleWSTETHEURChainlink;
  let oracleETH: OracleETHEURChainlink;
  let oracleBTC: OracleBTCEURChainlink;
  let oracleLUSD: OracleLUSDEURChainlink;
  let oracleTriCrypto2: OracleTriCrypto2EURChainlink;
  let oracleFRAXBP: OracleFRAXBPEURChainlink;
  let stalePeriod: BigNumber;
  let treasury: MockTreasury;

  before(async () => {
    [deployer, alice, bob] = await ethers.getSigners();
    stalePeriod = BigNumber.from(86400 * 52);
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
    oracleTriCrypto2 = await new OracleTriCrypto2EURChainlink__factory(deployer).deploy(stalePeriod, treasury.address);
    oracleFRAXBP = await new OracleFRAXBPEURChainlink__factory(deployer).deploy(stalePeriod, treasury.address);
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
      expect(await oracleETH.OUTBASE()).to.be.equal(parseEther('1'));
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
      expect(await oracleBTC.OUTBASE()).to.be.equal(parseEther('1'));
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
      expect(await oracleLUSD.OUTBASE()).to.be.equal(parseEther('1'));
      expect(await oracleLUSD.stalePeriod()).to.be.equal(stalePeriod);
      expect(await oracleLUSD.treasury()).to.be.equal(treasury.address);
    });
  });
  describe('Oracle TriCrypto2EUR', () => {
    it('read', async () => {
      const receipt = await oracleTriCrypto2.read();
      const gas = await oracleTriCrypto2.estimateGas.read();
      console.log(gas.toString());
      console.log(receipt.toString());
    });
    it('initialization', async () => {
      expect(await oracleTriCrypto2.TRI_CRYPTO_ORACLE()).to.be.equal('0xE8b2989276E2Ca8FDEA2268E3551b2b4B2418950');
      expect(await oracleTriCrypto2.stalePeriod()).to.be.equal(stalePeriod);
      expect(await oracleTriCrypto2.treasury()).to.be.equal(treasury.address);
    });
  });
  describe('Oracle FRAXBP', () => {
    it('read', async () => {
      const receipt = await oracleFRAXBP.read();
      const gas = await oracleFRAXBP.estimateGas.read();
      console.log(gas.toString());
      console.log(receipt.toString());
    });
    it('initialization', async () => {
      expect(await oracleFRAXBP.FRAXBP()).to.be.equal('0xDcEF968d416a41Cdac0ED8702fAC8128A64241A2');
      expect(await oracleFRAXBP.stalePeriod()).to.be.equal(stalePeriod);
      expect(await oracleFRAXBP.treasury()).to.be.equal(treasury.address);
    });
  });
});
