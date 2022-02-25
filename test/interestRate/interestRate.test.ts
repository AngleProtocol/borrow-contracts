import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BigNumber } from 'ethers';
import { parseUnits } from 'ethers/lib/utils';
import { contract, ethers } from 'hardhat';

import { MockInterestRateComputer, MockInterestRateComputer__factory } from '../../typechain';

contract('Interest Rates', () => {
  let deployer: SignerWithAddress;

  let computer: MockInterestRateComputer;
  let delta: BigNumber;

  beforeEach(async () => {
    [deployer] = await ethers.getSigners();
    // If the forked-network state needs to be reset between each test, run this
    // await network.provider.request({method: 'hardhat_reset', params: []});

    // To deploy a contract, import and use the contract factory specific to that contract
    computer = (await new MockInterestRateComputer__factory(deployer).deploy(
      parseUnits('1', 27),
      parseUnits('0.000000001243680714', 27),
    )) as MockInterestRateComputer;
    delta = BigNumber.from(86400 * 52);
  });

  describe('calculate delta', () => {
    it('aave', async () => {
      const receipt = await computer.calculateAave(delta);
      const gas = await computer.estimateGas.calculateAave(delta);
      console.log(gas.toString());
      console.log(receipt.toString());
    });
    it('angle', async () => {
      const receipt = await computer.calculateAngle(delta);
      const gas = await computer.estimateGas.calculateAngle(delta);
      console.log(gas.toString());
      console.log(receipt.toString());
    });
    it('maker', async () => {
      const receipt = await computer.calculateMaker(delta);
      const gas = await computer.estimateGas.calculateMaker(delta);
      console.log(gas.toString());
      console.log(receipt.toString());
    });
  });

  describe('calculate 1Year without steps', () => {
    it('aave', async () => {
      const receipt = await computer.calculateAave1YearDirect();
      const gas = await computer.estimateGas.calculateAave1YearDirect();
      console.log(gas.toString());
      console.log(receipt.toString());
    });
    it('angle', async () => {
      const receipt = await computer.calculateAngle1YearDirect();
      const gas = await computer.estimateGas.calculateAngle1YearDirect();
      console.log(gas.toString());
      console.log(receipt.toString());
    });
    it('maker', async () => {
      const receipt = await computer.calculateMaker1YearDirect();
      const gas = await computer.estimateGas.calculateMaker1YearDirect();
      console.log(gas.toString());
      console.log(receipt.toString());
    });
  });
  describe('calculate 1Year', () => {
    it('aave', async () => {
      const receipt = await computer.calculateAave1Year();
      const gas = await computer.estimateGas.calculateAave1Year();
      console.log(gas.toString());
      console.log(receipt.toString());
    });
    it('angle', async () => {
      const receipt = await computer.calculateAngle1Year();
      const gas = await computer.estimateGas.calculateAngle1Year();
      console.log(gas.toString());
      console.log(receipt.toString());
    });
    it('maker', async () => {
      const receipt = await computer.calculateMaker1Year();
      const gas = await computer.estimateGas.calculateMaker1Year();
      console.log(gas.toString());
      console.log(receipt.toString());
    });
  });
});
