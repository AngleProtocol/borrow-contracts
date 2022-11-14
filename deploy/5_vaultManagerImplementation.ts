import { DeployFunction } from 'hardhat-deploy/types';
import yargs from 'yargs';
const argv = yargs.env('').boolean('ci').parseSync();

const func: DeployFunction = async ({ deployments, ethers }) => {
  const { deploy } = deployments;
  const { deployer } = await ethers.getNamedSigners();

  console.log('Now deploying the implementation for VaultManager');
  await deploy('VaultManagerNoDust_Implementation', {
    contract: 'VaultManagerLiquidationBoost',
    from: deployer.address,
    args: [0, 0],
    log: !argv.ci,
  });

  const vaultManagerImplementation = (await ethers.getContract('VaultManagerNoDust_Implementation')).address;

  console.log(`Successfully deployed the implementation for VaultManager at ${vaultManagerImplementation}`);
  console.log('');
};

func.tags = ['vaultManagerImplementation'];
// func.dependencies = ['oracle'];
export default func;
