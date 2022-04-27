import { ChainId, CONTRACTS_ADDRESSES } from '@angleprotocol/sdk';
import { DeployFunction } from 'hardhat-deploy/types';

import { KeeperMulticall__factory } from '../typechain';

const func: DeployFunction = async ({ deployments, ethers, network }) => {
  const { deploy } = deployments;
  const { deployer } = await ethers.getNamedSigners();
  let proxyAdmin: string;
  const KEEPER = '0xcC617C6f9725eACC993ac626C7efC6B96476916E';

  if (!network.live) {
    // If we're in mainnet fork, we're using the `ProxyAdmin` address from mainnet
    proxyAdmin = CONTRACTS_ADDRESSES[ChainId.MAINNET].ProxyAdmin!;
  } else {
    // Otherwise, we're using the proxy admin address from the desired network
    proxyAdmin = CONTRACTS_ADDRESSES[network.config.chainId as ChainId].ProxyAdmin!;
  }

  console.log('Now deploying KeeperMulticall');
  console.log('Starting with the implementation');
  const keeperMulticallImplementation = await deploy('KeeperMulticall_Implementation', {
    contract: 'KeeperMulticall',
    from: deployer.address,
  });

  console.log(
    `Successfully deployed the implementation for KeeperMulticall at ${keeperMulticallImplementation.address}\n`,
  );

  const initializeData = KeeperMulticall__factory.createInterface().encodeFunctionData('initialize', [KEEPER]);

  console.log('Now deploying the Proxy');
  console.log(`Proxy admin: ${proxyAdmin}`);
  const keeperMulticall = await deploy('KeeperMulticall', {
    contract: 'TransparentUpgradeableProxy',
    from: deployer.address,
    args: [keeperMulticallImplementation.address, proxyAdmin, initializeData],
  });

  console.log(`Successfully deployed KeeperMulticall at the address ${keeperMulticall.address}\n`);

  // Next step: change Keeper to this new keeper contract where needed (strategy, ...)
  // see: scripts/mainnet-fork/changeKeeper.ts
};

func.tags = ['keeper_multicall'];
export default func;
