import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BigNumber } from 'ethers';
import { parseEther } from 'ethers/lib/utils';
import { contract, ethers } from 'hardhat';

import { expect } from '../../test/hardhat/utils/chai-setup';
import { ZERO_ADDRESS } from '../../test/hardhat/utils/helpers';
import {
  MockTreasury,
  MockTreasury__factory,
  OracleBTCEURChainlinkPolygon,
  OracleBTCEURChainlinkPolygon__factory,
  OracleMAIEURChainlinkPolygon,
  OracleMAIEURChainlinkPolygon__factory,
} from '../../typechain';

contract('Oracles Chainlink', () => {
  let deployer: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  let oracleBTC: OracleBTCEURChainlinkPolygon;
  let oracleMAI: OracleMAIEURChainlinkPolygon;
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
    oracleBTC = await new OracleBTCEURChainlinkPolygon__factory(deployer).deploy(stalePeriod, treasury.address);
    oracleMAI = await new OracleMAIEURChainlinkPolygon__factory(deployer).deploy(stalePeriod, treasury.address);
  });

  describe('Oracle BTC', () => {
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
  describe('Oracle MAI', () => {
    it('read', async () => {
      const receipt = await oracleMAI.read();
      const gas = await oracleMAI.estimateGas.read();
      console.log(gas.toString());
      console.log(receipt.toString());
    });
    it('initialization', async () => {
      expect(await oracleMAI.stalePeriod()).to.be.equal(stalePeriod);
      expect(await oracleMAI.treasury()).to.be.equal(treasury.address);
    });
  });
});
