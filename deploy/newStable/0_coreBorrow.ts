import { ChainId, registry } from '@angleprotocol/sdk';
import { DeployFunction } from 'hardhat-deploy/types';
import yargs from 'yargs';

import { CoreBorrow__factory } from '../../typechain';
import { forkedChain } from '../constants/constants';
const argv = yargs.env('').boolean('ci').parseSync();

/**
 * TODO: before starting the deployment, make sure that the constant are up to date with the stablecoin name
 */

const func: DeployFunction = async ({ deployments, ethers, network }) => {
  // This is for a test CoreBorrow implementation
  const { deploy } = deployments;
  const { deployer } = await ethers.getNamedSigners();
  const json = await import('../networks/' + network.name + '.json');
  const name = 'CoreBorrowTest';
  const governor = deployer.address;
  const guardian = json.guardian;
  let proxyAdmin: string;

  if (!network.live) {
    proxyAdmin = registry(forkedChain)?.ProxyAdmin!;
  } else {
    proxyAdmin = registry(network.config.chainId as ChainId)?.ProxyAdmin!;
  }

  let coreBorrowImplementation;
  try {
    coreBorrowImplementation = (await ethers.getContract('CoreBorrow_Implementation')).address;
  } catch {
    // Typically if we're in mainnet fork
    console.log('Now deploying CoreBorrow implementation');
    await deploy('CoreBorrow_Implementation', {
      contract: 'CoreBorrow',
      from: deployer.address,
      args: [],
      log: !argv.ci,
    });
    coreBorrowImplementation = (await ethers.getContract('CoreBorrow_Implementation')).address;
  }
  console.log('');

  const coreBorrowInterface = CoreBorrow__factory.createInterface();

  const dataCoreBorrow = new ethers.Contract(
    coreBorrowImplementation,
    coreBorrowInterface,
  ).interface.encodeFunctionData('initialize', [governor, guardian]);

  console.log(`Deploying the Proxy for ${name}`);
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

func.tags = ['coreNewStable'];
export default func;
