import yargs from 'yargs';
import { DeployFunction } from 'hardhat-deploy/types';
import { ChainId } from '@angleprotocol/sdk';
import { deployImplem } from './helpers';
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
  } else if (network.config.chainId === ChainId.POLYGON) {
    implementationName = 'TokenPolygonUpgradeable';
  } else {
    implementationName = 'AgTokenSideChainMultiBridge';
  }

  console.log(`Now deploying the implementation for AgToken on ${network.name}`);
  const agTokenImplementation = deployImplem(implementationName);

  if (network.config.chainId != 1 && network.config.chainId != ChainId.POLYGON) {
    console.log('Deploying the proxy for the agToken contract');
    proxyAdmin = (await deployments.get('ProxyAdmin')).address;

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
  }
};

func.tags = ['agTokenImplementation'];
// func.dependencies = ['coreBorrow'];
export default func;
