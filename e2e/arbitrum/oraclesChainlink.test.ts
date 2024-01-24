import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BigNumber } from 'ethers';
import { parseEther } from 'ethers/lib/utils';
import { contract, ethers } from 'hardhat';

import { expect } from '../../test/hardhat/utils/chai-setup';
import { ZERO_ADDRESS } from '../../test/hardhat/utils/helpers';
import {
  MockTreasury,
  MockTreasury__factory,
  OracleBTCEURChainlinkArbitrum,
  OracleBTCEURChainlinkArbitrum__factory,
  OracleSTEURETHChainlinkArbitrum,
  OracleSTEURETHChainlinkArbitrum__factory,
} from '../../typechain';

contract('Oracles Chainlink', () => {
  let deployer: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  let oracleBTC: OracleBTCEURChainlinkArbitrum;
  let oracleSTEUR: OracleSTEURETHChainlinkArbitrum;
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
    oracleBTC = await new OracleBTCEURChainlinkArbitrum__factory(deployer).deploy(stalePeriod, treasury.address);
    oracleSTEUR = await new OracleSTEURETHChainlinkArbitrum__factory(deployer).deploy(stalePeriod, treasury.address);
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
  describe('Oracle stEUR', () => {
    it('read', async () => {
      const receipt = await oracleSTEUR.read();
      const gas = await oracleSTEUR.estimateGas.read();
      console.log(gas.toString());
      console.log(receipt.toString());

      const latestAnswer = await oracleSTEUR.latestRoundData();
      console.log(
        latestAnswer[0].toString(),
        latestAnswer[1].toString(),
        latestAnswer[2].toString(),
        latestAnswer[3].toString(),
        latestAnswer[4].toString(),
      );
      expect(await oracleSTEUR.decimals()).to.be.equal(18);
    });
    it('initialization', async () => {
      expect(await oracleSTEUR.stalePeriod()).to.be.equal(stalePeriod);
      expect(await oracleSTEUR.treasury()).to.be.equal(treasury.address);
    });
  });
});
