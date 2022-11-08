import { ChainId, CONTRACTS_ADDRESSES } from '@angleprotocol/sdk';
import { DeployFunction } from 'hardhat-deploy/types';
import yargs from 'yargs';

import { deployImplem } from '../../helpers';
const argv = yargs.env('').boolean('ci').parseSync();

const func: DeployFunction = async ({ deployments, ethers, network }) => {
  const { deploy } = deployments;
  const { deployer } = await ethers.getNamedSigners();
  let proxyAdmin: string;

  if (!network.live) {
    // If we're in mainnet fork, we're using the `ProxyAdmin` address from mainnet
    proxyAdmin = CONTRACTS_ADDRESSES[ChainId.MAINNET].ProxyAdmin!;
  } else {
    // Otherwise, we're using the proxy admin address from the desired network
    proxyAdmin = (await ethers.getContract('ProxyAdmin')).address;
  }

  console.log(`Now deploying the implementation for ANGLE on ${network.name}`);

  await deploy('AngleSideChainMultiBridge_implementation', {
    contract: 'AngleSideChainMultiBridge',
    from: deployer.address,
    log: !argv.ci,
  });
  const angleImplementation = await deployments.get('AngleSideChainMultiBridge_implementation');
  console.log('Deploying the proxy for the agToken contract');

  console.log(angleImplementation.address, proxyAdmin);

  await deploy(`ANGLE_${network.name}`, {
    contract: 'TransparentUpgradeableProxy',
    from: deployer.address,
    // empty data because initialize should be called in a subsequent transaction
    args: [angleImplementation.address, proxyAdmin, '0x'],
    log: !argv.ci,
  });

  console.log('Success, initialize will be called in a subsequent transaction');
};

func.tags = ['angleSideChain'];
export default func;
