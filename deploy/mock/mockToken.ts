import { DeployFunction } from 'hardhat-deploy/types';
import yargs from 'yargs';

const argv = yargs.env('').boolean('ci').parseSync();

const func: DeployFunction = async ({ deployments, ethers }) => {
  const { deploy } = deployments;
  const { deployer } = await ethers.getNamedSigners();

  console.log('Now deploying MockTokens');
  // wBTC will not have a permit
  await deploy('wBTC', {
    contract: 'MockToken',
    from: deployer.address,
    args: ['wBTC', 'wBTC', 8],
    log: !argv.ci,
  });
  const token1 = (await deployments.get('wBTC')).address;
  console.log(`Successfully deployed Mock wBTC at the address ${token1}`);
  console.log('');

  await deploy('LINK', {
    contract: 'MockTokenPermit',
    from: deployer.address,
    args: ['LINK', 'LINK', 18],
    log: !argv.ci,
  });
  const token2 = (await deployments.get('LINK')).address;
  console.log(`Successfully deployed Mock LINK at the address ${token2}`);
  console.log('');
};

func.tags = ['mockToken'];
export default func;
