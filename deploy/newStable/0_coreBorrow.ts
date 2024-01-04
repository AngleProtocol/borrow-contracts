import { ChainId, CONTRACTS_ADDRESSES } from '@angleprotocol/sdk';
import { DeployFunction } from 'hardhat-deploy/types';
import yargs from 'yargs';

import { CoreBorrow__factory } from '../../typechain';
const argv = yargs.env('').boolean('ci').parseSync();

const func: DeployFunction = async ({ deployments, ethers, network }) => {
  // This is for a test CoreBorrow implementation
  const { deploy } = deployments;
  const { deployer } = await ethers.getNamedSigners();
  const json = await import('./networks/' + network.name + '.json');
  const name = 'CoreBorrowTest';
  const governor = deployer.address;
  const guardian = json.guardian;
  let proxyAdmin: string;

  if (!network.live) {
    // If we're in mainnet fork, we're using the `ProxyAdmin` address from mainnet
    proxyAdmin = CONTRACTS_ADDRESSES[ChainId.MAINNET]?.ProxyAdmin!;
  } else {
    // Otherwise, we're using the proxy admin address from the desired network
    proxyAdmin = (await deployments.get('ProxyAdmin')).address;
  }

  // Implementation has already been deployed on every chain here
  const coreBorrowImplementation = (await ethers.getContract('CoreBorrow_Implementation')).address;
  console.log('');

  const coreBorrowInterface = CoreBorrow__factory.createInterface();

  const dataCoreBorrow = new ethers.Contract(
    coreBorrowImplementation,
    coreBorrowInterface,
  ).interface.encodeFunctionData('initialize', [governor, guardian]);

  console.log(`Now deploying the Proxy for ${name}`);
  console.log('The contract will be initialized with the following governor and guardian addresses');
  console.log(governor, guardian);

  await deploy(name, {
    contract: 'TransparentUpgradeableProxy',
    from: deployer.address,
    args: [coreBorrowImplementation, proxyAdmin, dataCoreBorrow],
    log: !argv.ci,
  });

  const coreBorrow = (await deployments.get(name)).address;
  console.log(`Successfully deployed ${name} at the address ${coreBorrow}`);

  console.log(`${coreBorrow} ${coreBorrowImplementation} ${proxyAdmin} ${dataCoreBorrow} `);
  console.log('');
};

func.tags = ['coreBorrowStablecoin'];
export default func;
