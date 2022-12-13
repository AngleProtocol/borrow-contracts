import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BigNumber } from 'ethers';
import { parseEther } from 'ethers/lib/utils';
import { contract, ethers } from 'hardhat';

import { expect } from '../../test/hardhat/utils/chai-setup';
import { ZERO_ADDRESS } from '../../test/hardhat/utils/helpers';
import {
  MockTreasury,
  MockTreasury__factory,
  OracleAVAXEURChainlinkAvalanche,
  OracleAVAXEURChainlinkAvalanche__factory,
  OracleUSDCEURChainlinkAvalanche,
  OracleUSDCEURChainlinkAvalanche__factory,
} from '../../typechain';

contract('Oracles Chainlink', () => {
  let deployer: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  let oracleAVAX: OracleAVAXEURChainlinkAvalanche;
  let oracleUSDC: OracleUSDCEURChainlinkAvalanche;
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
    oracleAVAX = await new OracleAVAXEURChainlinkAvalanche__factory(deployer).deploy(stalePeriod, treasury.address);
    oracleUSDC = await new OracleUSDCEURChainlinkAvalanche__factory(deployer).deploy(stalePeriod, treasury.address);
  });

  describe('Oracle AVAX', () => {
    it('read', async () => {
      const receipt = await oracleAVAX.read();
      const gas = await oracleAVAX.estimateGas.read();
      console.log(gas.toString());
      console.log(receipt.toString());
    });
    it('initialization', async () => {
      expect(await oracleAVAX.stalePeriod()).to.be.equal(stalePeriod);
      expect(await oracleAVAX.treasury()).to.be.equal(treasury.address);
      const circuitChainlink = await oracleAVAX.circuitChainlink();
      expect(circuitChainlink[0]).to.be.equal('0x0A77230d17318075983913bC2145DB16C7366156');
      expect(circuitChainlink[1]).to.be.equal('0x192f2DBA961Bb0277520C082d6bfa87D5961333E');
    });
  });

  describe('Oracle USDC', () => {
    it('read', async () => {
      const receipt = await oracleUSDC.read();
      const gas = await oracleUSDC.estimateGas.read();
      console.log(gas.toString());
      console.log(receipt.toString());
    });
    it('initialization', async () => {
      expect(await oracleUSDC.stalePeriod()).to.be.equal(stalePeriod);
      expect(await oracleUSDC.treasury()).to.be.equal(treasury.address);
      const circuitChainlink = await oracleUSDC.circuitChainlink();
      expect(circuitChainlink[0]).to.be.equal('0xF096872672F44d6EBA71458D74fe67F9a77a23B9');
      expect(circuitChainlink[1]).to.be.equal('0x192f2DBA961Bb0277520C082d6bfa87D5961333E');
    });
  });
});
