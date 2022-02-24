import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BigNumber } from 'ethers';
import { parseEther, parseUnits } from 'ethers/lib/utils';
import { contract, ethers, web3 } from 'hardhat';
import { deployUpgradeable, latestTime, ZERO_ADDRESS } from '../utils/helpers';

import {
  OracleChainlinkMulti,
  OracleChainlinkMulti__factory,
  MockChainlinkOracle,
  MockChainlinkOracle__factory,
  MockTreasury,
  MockTreasury__factory,
} from '../../typechain';
import { expect } from '../utils/chai-setup';
import { inReceipt } from '../utils/expectEvent';

contract('OracleChainlinkMulti', () => {
  let deployer: SignerWithAddress;

  let oracle: OracleChainlinkMulti;
  let chainlink: MockChainlinkOracle;
  let stalePeriod: BigNumber;
  let treasury: MockTreasury;

  beforeEach(async () => {
    [deployer] = await ethers.getSigners();
    stalePeriod = BigNumber.from(86400 * 52);
    treasury = (await new MockTreasury__factory(deployer).deploy(
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
    )) as MockTreasury;
    chainlink = (await new MockChainlinkOracle__factory(deployer).deploy()) as MockChainlinkOracle;
    await chainlink.setDecimals(18);
    await chainlink.setLatestAnswer(parseEther('1'), await latestTime());
    oracle = (await new OracleChainlinkMulti__factory(deployer).deploy(
      [chainlink.address],
      [1],
      parseEther('1'),
      stalePeriod,
      treasury.address,
      web3.utils.keccak256('desc'),
    )) as OracleChainlinkMulti;
  });

  describe('constructor', () => {
    it('success - variables correctly initialized', async () => {
      expect(await oracle.outBase()).to.be.equal(parseEther('1'));
      expect(await oracle.circuitChainlink(0)).to.be.equal(chainlink.address);
      expect(await oracle.chainlinkDecimals(0)).to.be.equal(18);
      expect(await oracle.circuitChainIsMultiplied(0)).to.be.equal(1);
      expect(await oracle.description()).to.be.equal(web3.utils.keccak256('desc'));
      expect(await oracle.stalePeriod()).to.be.equal(stalePeriod);
      expect(await oracle.treasury()).to.be.equal(treasury.address);
    });
    it('reverts - invalid circuit length', async () => {
      await expect(
        new OracleChainlinkMulti__factory(deployer).deploy(
          [chainlink.address],
          [1, 0],
          parseEther('1'),
          stalePeriod,
          treasury.address,
          web3.utils.keccak256('desc'),
        ),
      ).to.be.revertedWith('25');
      await expect(
        new OracleChainlinkMulti__factory(deployer).deploy(
          [],
          [1],
          parseEther('1'),
          stalePeriod,
          treasury.address,
          web3.utils.keccak256('desc'),
        ),
      ).to.be.revertedWith('25');
    });
  });
  describe('read', () => {
    it('success - correct value output', async () => {
      expect(await oracle.read()).to.be.equal(parseEther('1'));
    });
    it('success - with circuit', async () => {
      const oracleNew = (await new OracleChainlinkMulti__factory(deployer).deploy(
        [chainlink.address, chainlink.address],
        [1, 0],
        parseEther('1'),
        stalePeriod,
        treasury.address,
        web3.utils.keccak256('desc'),
      )) as OracleChainlinkMulti;
      expect(await oracleNew.read()).to.be.equal(parseEther('1'));
    });
    it('reverts - zero ratio', async () => {
      await chainlink.setLatestAnswer(parseEther('0'), await latestTime());
      await expect(oracle.read()).to.be.revertedWith('37');
    });
    it('reverts - Chainlink reverts', async () => {
      await chainlink.setLatestRoundDataShouldRevert(true);
      await expect(oracle.read()).to.be.reverted;
    });
    it('reverts - stale period', async () => {
      const timestamp = await latestTime();
      await chainlink.setLatestAnswerRevert(parseEther('1'), await latestTime());
      await expect(oracle.read()).to.be.revertedWith('37');
    });
  });
  describe('changeStalePeriod', () => {
    it('reverts - wrong sender', async () => {
      await expect(oracle.changeStalePeriod(0)).to.be.revertedWith('2');
    });
    it('success - stalePeriod updated', async () => {
      await treasury.setGovernor(deployer.address);
      const receipt = await (await oracle.connect(deployer).changeStalePeriod(0)).wait();
      inReceipt(receipt, 'StalePeriodUpdated', {
        _stalePeriod: 0,
      });
      expect(await oracle.stalePeriod()).to.be.equal(0);
      await expect(oracle.read()).to.be.revertedWith('37');
    });
  });
  describe('setTreasury', () => {
    it('reverts - wrong sender', async () => {
      await expect(oracle.setTreasury(ZERO_ADDRESS)).to.be.revertedWith('3');
    });
    it('success - treasury updated', async () => {
      await treasury.setVaultManager(deployer.address);
      await oracle.connect(deployer).setTreasury(ZERO_ADDRESS);
      expect(await oracle.treasury()).to.be.equal(ZERO_ADDRESS);
    });
  });
});
