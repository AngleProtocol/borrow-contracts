import yargs from 'yargs';
import { DeployFunction } from 'hardhat-deploy/types';
import { ChainId } from '@angleprotocol/sdk';
const argv = yargs.env('').boolean('ci').parseSync();

const func: DeployFunction = async ({ deployments, ethers, network }) => {
  const { deploy } = deployments;
  const { deployer } = await ethers.getNamedSigners();
  const stableName = 'EUR';

  let implementationName: string;
  let proxyAdmin: string;

  if (network.config.chainId == 1 || !network.live) {
    // If we're in mainnet fork or on mainnet, we're using the agToken implementation address for mainnet
    implementationName = 'AgToken';
  } else {
    implementationName = 'AgTokenSideChainMultiBridge';
  }
  /* TODO Uncomment for real Polygon deployment
    else if (network.config.chainId !== ChainId.POLYGON) {
      implementationName = 'TokenPolygonUpgradeable';
    } else {
      implementationName = 'AgTokenSideChain';
    }
  */

  console.log(`Now deploying the implementation for AgToken on ${network.name}`);
  await deploy(`${implementationName}_Implementation`, {
    contract: implementationName,
    from: deployer.address,
    log: !argv.ci,
  });
  const agTokenImplementation = (await ethers.getContract(`${implementationName}_Implementation`)).address;

  console.log(`Successfully deployed the implementation for AgToken at ${agTokenImplementation}`);
  console.log('');

  if (network.config.chainId != 1) {
    /* TODO Uncomment for real Polygon deployment
    if (network.config.chainId != 1 && network.config.chainId!= ChainId.POLYGON) {
  */
    console.log('Deploying the proxy for the agToken contract because chain is not mainnet and we need a new contract');
    proxyAdmin = (await deployments.get('ProxyAdmin')).address;
    await deploy(`AgToken_${stableName}`, {
      contract: 'TransparentUpgradeableProxy',
      from: deployer.address,
      // empty data because initialize should be called in a subsequent transaction
      args: [agTokenImplementation, proxyAdmin, '0x'],
      log: !argv.ci,
    });
    console.log('Success');
  }
};

func.tags = ['agTokenImplementation'];
// func.dependencies = ['coreBorrow'];
export default func;
