import yargs from 'yargs';
import { DeployFunction } from 'hardhat-deploy/types';

import { CONTRACTS_ADDRESSES, ChainId } from '@angleprotocol/sdk';
import { Treasury__factory } from '../typechain';
const argv = yargs.env('').boolean('ci').parseSync();

const func: DeployFunction = async ({ deployments, ethers, network }) => {
  const { deploy } = deployments;
  const { deployer } = await ethers.getNamedSigners();
  let proxyAdmin: string;
  let agToken: string;

  if (!network.live) {
    // If we're in mainnet fork, we're using the `ProxyAdmin` address from mainnet
    proxyAdmin = CONTRACTS_ADDRESSES[ChainId.MAINNET].ProxyAdmin!;
    agToken = CONTRACTS_ADDRESSES[ChainId.MAINNET].agEUR?.AgToken!;
  } else {
    // Otherwise, we're using the proxy admin address from the desired network
    proxyAdmin = CONTRACTS_ADDRESSES[network.config.chainId as ChainId].ProxyAdmin!;
    agToken = CONTRACTS_ADDRESSES[network.config.chainId as ChainId].agEUR?.AgToken!;
  }

  console.log('Now deploying Treasury');
  console.log('Starting with the implementation');
  await deploy('Treasury_Implementation', {
    contract: 'Treasury',
    from: deployer.address,
    log: !argv.ci,
  });
  const treasuryImplementation = (await ethers.getContract('Treasury_Implementation')).address;

  console.log(`Successfully deployed the implementation for Treasury at ${treasuryImplementation}`);
  console.log('');

  const treasuryInterface = Treasury__factory.createInterface();

  const coreBorrow = await deployments.get('CoreBorrow');

  const dataTreasury = new ethers.Contract(
    treasuryImplementation,
    treasuryInterface,
  ).interface.encodeFunctionData('initialize', [coreBorrow.address, agToken]);

  console.log('Now deploying the Proxy');
  await deploy('Treasury', {
    contract: 'TransparentUpgradeableProxy',
    from: deployer.address,
    args: [treasuryImplementation, proxyAdmin, dataTreasury],
    log: !argv.ci,
  });

  const treasury = (await deployments.get('Treasury')).address;
  console.log(`Successfully deployed Treasury at the address ${treasury}`);
  console.log('');
};

func.tags = ['treasury'];
func.dependencies = ['coreBorrow'];
export default func;
