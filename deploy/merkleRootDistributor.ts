import { ChainId, CONTRACTS_ADDRESSES } from '@angleprotocol/sdk';
import { DeployFunction } from 'hardhat-deploy/types';

import { MerkleRootDistributor__factory } from '../typechain';

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

  console.log('Now deploying MerkleRootDistributor');
  console.log('Starting with the implementation');
  const merkleRootDistributorImplementation = await deploy('MerkleRootDistributor_Implementation', {
    contract: 'MerkleRootDistributor',
    from: deployer.address,
  });

  console.log(
    `Successfully deployed the implementation for MerkleRootDistributor at ${merkleRootDistributorImplementation.address}\n`,
  );

  const initializeData = MerkleRootDistributor__factory.createInterface().encodeFunctionData('initialize', [
    CONTRACTS_ADDRESSES[ChainId.MAINNET].agEUR.Treasury as string,
  ]);

  console.log('Now deploying the Proxy');
  console.log(`Proxy admin: ${proxyAdmin}`);
  const merkleRootDistributor = await deploy('MerkleRootDistributor', {
    contract: 'TransparentUpgradeableProxy',
    from: deployer.address,
    args: [merkleRootDistributorImplementation.address, proxyAdmin, initializeData],
  });

  console.log(`Successfully deployed MerkleRootDistributor at the address ${merkleRootDistributor.address}\n`);

  // Next step: change Keeper to this new keeper contract where needed (strategy, ...)
  // see: scripts/mainnet-fork/changeKeeper.ts
};

func.tags = ['merkleRootDistributor'];
export default func;
