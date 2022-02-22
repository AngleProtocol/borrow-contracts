import yargs from 'yargs';
import { DeployFunction } from 'hardhat-deploy/types';

import { CONTRACTS_ADDRESSES, ChainId } from '@angleprotocol/sdk';
import { FlashAngle__factory } from '../typechain';
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
    proxyAdmin = CONTRACTS_ADDRESSES[network.config.chainId as ChainId].ProxyAdmin!;
  }

  console.log('Now deploying FlashAngle');
  console.log('Starting with the implementation');
  await deploy('FlashAngle_Implementation', {
    contract: 'FlashAngle',
    from: deployer.address,
    log: !argv.ci,
  });
  const flashAngleImplementation = (await ethers.getContract('FlashAngle_Implementation')).address;

  console.log(`Successfully deployed the implementation for FlashAngle at ${flashAngleImplementation}`);

  const flashAngleInterface = FlashAngle__factory.createInterface();

  const coreBorrow = await deployments.get('CoreBorrow');

  const dataFlashAngle = new ethers.Contract(
    flashAngleImplementation,
    flashAngleInterface,
  ).interface.encodeFunctionData('initialize', [coreBorrow.address]);

  console.log('Now deploying the Proxy');
  await deploy('FlashAngle', {
    contract: 'TransparentUpgradeableProxy',
    from: deployer.address,
    args: [flashAngleImplementation, proxyAdmin, dataFlashAngle],
    log: !argv.ci,
  });

  const flashAngle = (await deployments.get('FlashAngle')).address;
  console.log(`Successfully deployed FlashAngle at the address ${flashAngle}`);
  console.log('');
};

func.tags = ['flashAngle'];
func.dependencies = ['treasury'];
export default func;
