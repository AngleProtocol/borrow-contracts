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

contract('Interest Rates', () => {
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
    await chainlink.setDecimals(8);
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
      expect(await oracle.chainlinkDecimals(0)).to.be.equal(8);
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
      ).to.be.revertedWith('32');
      await expect(
        new OracleChainlinkMulti__factory(deployer).deploy(
          [],
          [1],
          parseEther('1'),
          stalePeriod,
          treasury.address,
          web3.utils.keccak256('desc'),
        ),
      ).to.be.revertedWith('32');
    });
  });
});
