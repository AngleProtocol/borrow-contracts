import { parseEther } from 'ethers/lib/utils';
import { DeployFunction } from 'hardhat-deploy/types';
import yargs from 'yargs';
const argv = yargs.env('').boolean('ci').parseSync();

const func: DeployFunction = async ({ deployments, ethers, network }) => {
  const { deploy } = deployments;
  const { deployer } = await ethers.getNamedSigners();
  const json = await import('./networks/' + network.name + '.json');
  const dust = json.dust;

  console.log('Now deploying the implementation for VaultManager');
  console.log(`Dust for this collateral is going to be ${dust}`);
  await deploy('VaultManager_Implementation', {
    contract: 'VaultManagerLiquidationBoost',
    from: deployer.address,
    args: [parseEther(dust), parseEther(dust)],
    log: !argv.ci,
  });

  const vaultManagerImplementation = (await ethers.getContract('VaultManager_Implementation')).address;

  console.log(`Successfully deployed the implementation for VaultManager at ${vaultManagerImplementation}`);
  console.log('');
};

func.tags = ['vaultManagerImplementation'];
func.dependencies = ['oracle'];
export default func;
