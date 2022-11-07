import { ChainId, CONTRACTS_ADDRESSES } from '@angleprotocol/sdk';
import { DeployFunction } from 'hardhat-deploy/types';
import yargs from 'yargs';

import { MerkleRewardManager__factory } from '../typechain';
import { parseAmount } from '../utils/bignumber';
const argv = yargs.env('').boolean('ci').parseSync();

const func: DeployFunction = async ({ deployments, ethers, network }) => {
  const { deploy } = deployments;
  const { deployer } = await ethers.getNamedSigners();

  let proxyAdmin: string;
  let coreBorrow: string;
  let distributor: string;

  if (!network.live) {
    // If we're in mainnet fork, we're using the `ProxyAdmin` address from mainnet
    proxyAdmin = CONTRACTS_ADDRESSES[ChainId.MAINNET].ProxyAdmin!;
    coreBorrow = CONTRACTS_ADDRESSES[ChainId.MAINNET].CoreBorrow!;
    distributor = CONTRACTS_ADDRESSES[ChainId.MAINNET].MerkleRootDistributor!;
  } else {
    // Otherwise, we're using the proxy admin address from the desired network
    proxyAdmin = CONTRACTS_ADDRESSES[network.config.chainId as ChainId].ProxyAdmin!;
    coreBorrow = CONTRACTS_ADDRESSES[network.config.chainId as ChainId].CoreBorrow!;
    distributor = CONTRACTS_ADDRESSES[network.config.chainId as ChainId].MerkleRootDistributor!;
  }

  console.log('Now deploying MerkleRewardManager');
  console.log('Starting with the implementation');
  // TODO change implementation depending on deployment
  const merkleRewardManagerImplementation = await deploy('MerkleRewardManager_TestImplementation', {
    contract: 'MerkleRewardManagerPolygon',
    from: deployer.address,
    args: [],
    log: !argv.ci,
  });

  console.log(
    `Successfully deployed the implementation for MerkleRewardManager at ${merkleRewardManagerImplementation.address}\n`,
  );

  const initializeData = MerkleRewardManager__factory.createInterface().encodeFunctionData('initialize', [
    coreBorrow,
    distributor,
    parseAmount.gwei('0.01'),
  ]);

  console.log('Now deploying the Proxy');
  console.log(`Proxy admin: ${proxyAdmin}`);
  const merkleRewardManager = await deploy('MerkleRewardManagerTest', {
    contract: 'TransparentUpgradeableProxy',
    from: deployer.address,
    args: [merkleRewardManagerImplementation.address, proxyAdmin, initializeData],
  });

  console.log(`Successfully deployed MerkleRewardManager at the address ${merkleRewardManager.address}\n`);
};

func.tags = ['merkleRewardManager'];
export default func;
