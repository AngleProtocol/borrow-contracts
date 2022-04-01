import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BigNumber, Signer, utils } from 'ethers';
import { parseEther, parseUnits } from 'ethers/lib/utils';
import hre, { contract, ethers } from 'hardhat';

import {
  MockTreasury,
  MockTreasury__factory,
  OracleWSTETHEURChainlink,
  OracleWSTETHEURChainlink__factory,
  OracleETHEURChainlink,
  OracleETHEURChainlink__factory,
  OracleBTCEURChainlink,
  OracleBTCEURChainlink__factory,
} from '../../typechain';
import { expect } from '../../test/utils/chai-setup';
import { deployUpgradeable, ZERO_ADDRESS } from '../../test/utils/helpers';

contract('Oracles Chainlink', () => {
  let deployer: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  let oracleWSTETH: OracleWSTETHEURChainlink;
  let oracleETH: OracleETHEURChainlink;
  let oracleBTC: OracleBTCEURChainlink;
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
});
