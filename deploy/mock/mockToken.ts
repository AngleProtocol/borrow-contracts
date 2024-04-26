import { DeployFunction } from 'hardhat-deploy/types';
import yargs from 'yargs';

const argv = yargs.env('').boolean('ci').parseSync();

const func: DeployFunction = async ({ deployments, ethers }) => {
  const { deploy } = deployments;
  const { deployer } = await ethers.getNamedSigners();

  console.log('Now deploying MockTokens');
  // wBTC will not have a permit
  await deploy('MockEUR', {
    contract: 'MockToken',
    from: deployer.address,
    args: ['mockEUR', 'mockEUR', 18],
    log: !argv.ci,
  });
  const token1 = (await deployments.get('aglaMerkl')).address;
  console.log(`Successfully deployed Mock aglaMerkl at the address ${token1}`);
  console.log('');
};

func.tags = ['mockToken'];
export default func;
