import { DeployFunction } from 'hardhat-deploy/types';
import yargs from 'yargs';

import { MockCoreBorrow, MockCoreBorrow__factory } from '../../typechain';
const argv = yargs.env('').boolean('ci').parseSync();

const func: DeployFunction = async ({ deployments, ethers }) => {
  const { deploy } = deployments;
  const { deployer } = await ethers.getNamedSigners();

  console.log('Now deploying MockCoreBorrow');
  await deploy('MockCoreBorrow', {
    contract: 'MockCoreBorrow',
    from: deployer.address,
    args: [],
    log: !argv.ci,
  });
  const mockContract = (await deployments.get('MockCoreBorrow')).address;
  console.log(`Successfully deployed MockCoreBorrow at the address ${mockContract}`);
  const core = new ethers.Contract(mockContract, MockCoreBorrow__factory.createInterface(), deployer) as MockCoreBorrow;
  await core.toggleGovernor(deployer.address);
  await core.toggleGuardian(deployer.address);
  console.log('');
};

func.tags = ['mockCoreBorrow'];
export default func;
