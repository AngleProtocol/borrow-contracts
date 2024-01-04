// To deploy an agToken on a new chain
import { ChainId, registry } from '@angleprotocol/sdk';
import { DeployFunction } from 'hardhat-deploy/types';
import yargs from 'yargs';

const argv = yargs.env('').boolean('ci').parseSync();

const func: DeployFunction = async ({ deployments, ethers, network }) => {
  const { deploy } = deployments;
  const { deployer } = await ethers.getNamedSigners();
  const stableName = 'EUR';

  const implementationName = 'AgTokenSideChainMultiBridge';
  const proxyAdmin = (await deployments.get('ProxyAdmin')).address;

  console.log(`Now deploying the implementation for AgToken on ${network.name}`);
  console.log(`Using implementation ${implementationName}`);

  await deploy(`${implementationName}_Implementation`, {
    contract: implementationName,
    from: deployer.address,
    args: [],
    log: !argv.ci,
  });

  const agTokenImplementation = (await deployments.get(`${implementationName}_Implementation`)).address;

  console.log('Deploying the proxy for the agToken contract');

  await deploy(`AgToken_${stableName}`, {
    contract: 'TransparentUpgradeableProxy',
    from: deployer.address,
    // empty data because initialize should be called in a subsequent transaction
    args: [agTokenImplementation, proxyAdmin, '0x'],
    log: !argv.ci,
  });

  const agTokenAddress = (await deployments.get(`AgToken_${stableName}`)).address;
  console.log(`Successfully deployed ${`AgToken_${stableName}`} at the address ${agTokenAddress}`);
  console.log(`${agTokenAddress} ${agTokenImplementation} ${proxyAdmin} '0x'`);
  console.log('');
};

func.tags = ['agTokenImplementation'];
// func.dependencies = ['coreBorrow'];
export default func;
