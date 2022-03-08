import { parseEther } from 'ethers/lib/utils';
import { DeployFunction } from 'hardhat-deploy/types';
import yargs from 'yargs';
const argv = yargs.env('').boolean('ci').parseSync();

const func: DeployFunction = async ({ deployments, ethers }) => {
  const { deploy } = deployments;
  const { deployer } = await ethers.getNamedSigners();

  console.log('Now deploying the implementation for VaultManager');
  await deploy('VaultManager_Implementation', {
    contract: 'VaultManager',
    from: deployer.address,
    args: [parseEther('10000'), parseEther('10000')], // TODO Dust Parameters
    log: !argv.ci,
  });
  const vaultManagerImplementation = (await ethers.getContract('VaultManager_Implementation')).address;

  console.log(`Successfully deployed the implementation for VaultManager at ${vaultManagerImplementation}`);
  console.log('');
};

func.tags = ['vaultManagerImplementation'];
// func.dependencies = ['flashAngle'];
export default func;
