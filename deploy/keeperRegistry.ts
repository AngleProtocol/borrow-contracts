import { ChainId, CONTRACTS_ADDRESSES } from '@angleprotocol/sdk';
import { DeployFunction } from 'hardhat-deploy/types';

import { KeeperRegistry__factory, MerkleRootDistributor__factory } from '../typechain';

const func: DeployFunction = async ({ deployments, ethers, network }) => {
  const { deploy } = deployments;
  const { deployer } = await ethers.getNamedSigners();
  let proxyAdmin: string;

  if (!network.live) {
    // If we're in mainnet fork, we're using the `ProxyAdmin` address from mainnet
    proxyAdmin = CONTRACTS_ADDRESSES[ChainId.MAINNET].ProxyAdmin!;
  } else {
    // Otherwise, we're using the proxy admin address from the desired network
    proxyAdmin = CONTRACTS_ADDRESSES[network.config.chainId as ChainId].ProxyAdmin!;
  }

  const contractName = 'KeeperRegistry';

  console.log(`Now deploying ${contractName}`);
  console.log(`Starting with the implementation`);
  const implementation = await deploy(`${contractName}_Implementation`, {
    contract: contractName,
    from: deployer.address,
  });

  console.log(`Successfully deployed the implementation for ${contractName} at ${implementation.address}\n`);

  const initializeData = KeeperRegistry__factory.createInterface().encodeFunctionData('initialize', [
    CONTRACTS_ADDRESSES[ChainId.MAINNET].CoreBorrow as string,
  ]);

  console.log('Now deploying the Proxy');
  console.log(`Proxy admin: ${proxyAdmin}`);
  const proxy = await deploy(`${contractName}`, {
    contract: 'TransparentUpgradeableProxy',
    from: deployer.address,
    args: [implementation.address, proxyAdmin, initializeData],
  });

  console.log(`Successfully deployed ${contractName} at the address ${proxy.address}\n`);
};

func.tags = ['keeperRegistry'];
export default func;
