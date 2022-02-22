import yargs from 'yargs';
import { DeployFunction } from 'hardhat-deploy/types';

import { CONTRACTS_ADDRESSES, ChainId } from '@angleprotocol/sdk';
import { CoreBorrow__factory } from '../typechain';
const argv = yargs.env('').boolean('ci').parseSync();

const func: DeployFunction = async ({ deployments, ethers, network }) => {
  const { deploy } = deployments;
  const { deployer } = await ethers.getNamedSigners();
  const json = await import('./networks/' + network.name + '.json');
  const governor = json.governor;
  const guardian = json.guardian;
  let proxyAdmin: string;

  if (!network.live) {
    // If we're in mainnet fork, we're using the `ProxyAdmin` address from mainnet
    proxyAdmin = CONTRACTS_ADDRESSES[ChainId.MAINNET].ProxyAdmin!;
  } else {
    // Otherwise, we're using the proxy admin address from the desired network
    proxyAdmin = CONTRACTS_ADDRESSES[network.config.chainId as ChainId].ProxyAdmin!;
  }

  console.log('Now deploying CoreBorrow');
  console.log('Starting with the implementation');
  await deploy('CoreBorrow_Implementation', {
    contract: 'CoreBorrow',
    from: deployer.address,
    log: !argv.ci,
  });
  const coreBorrowImplementation = (await ethers.getContract('CoreBorrow_Implementation')).address;

  console.log(`Successfully deployed the implementation for CoreBorrow at ${coreBorrowImplementation}`);

  const coreBorrowInterface = CoreBorrow__factory.createInterface();

  const dataCoreBorrow = new ethers.Contract(
    coreBorrowImplementation,
    coreBorrowInterface,
  ).interface.encodeFunctionData('initialize', [governor, guardian]);

  console.log('Now deploying the Proxy');
  await deploy('CoreBorrow', {
    contract: 'TransparentUpgradeableProxy',
    from: deployer.address,
    args: [coreBorrowImplementation, proxyAdmin, dataCoreBorrow],
    log: !argv.ci,
  });

  const coreBorrow = (await deployments.get('CoreBorrow')).address;
  console.log(`Successfully deployed CoreBorrow at the address ${coreBorrow}`);
  console.log('');
};

func.tags = ['coreBorrow'];
export default func;
