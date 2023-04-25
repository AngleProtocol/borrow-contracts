import { DeployFunction } from 'hardhat-deploy/types';
import yargs from 'yargs';
const argv = yargs.env('').boolean('ci').parseSync();

const func: DeployFunction = async ({ deployments, ethers }) => {
  const { deploy } = deployments;
  const { deployer } = await ethers.getNamedSigners();

  const implementationName = 'VaultManager_V2_1_Implementation';

  try {
    await deployments.get(implementationName);
  } catch {
    console.log('Now deploying the implementation for VaultManager');
    await deploy(implementationName, {
      contract: 'VaultManagerLiquidationBoost',
      from: deployer.address,
      args: [],
      log: !argv.ci,
    });
    const vaultManagerImplementation = (await ethers.getContract(implementationName)).address;
    console.log(`Successfully deployed the implementation for VaultManager at ${vaultManagerImplementation}`);
    console.log('');
  }
};

func.tags = ['vaultManagerImplementation'];
func.dependencies = ['oracle'];
export default func;
