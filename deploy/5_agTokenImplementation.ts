import yargs from 'yargs';
import { DeployFunction } from 'hardhat-deploy/types';
const argv = yargs.env('').boolean('ci').parseSync();

const func: DeployFunction = async ({ deployments, ethers }) => {
  const { deploy } = deployments;
  const { deployer } = await ethers.getNamedSigners();

  console.log('Now deploying the implementation for AgToken');
  await deploy('AgToken_Implementation', {
    contract: 'AgToken',
    from: deployer.address,
    log: !argv.ci,
  });
  const agTokenImplementation = (await ethers.getContract('AgToken_Implementation')).address;

  console.log(`Successfully deployed the implementation for AgToken at ${agTokenImplementation}`);
};

func.tags = ['agTokenImplementation'];
func.dependencies = ['flashAngle'];
export default func;
