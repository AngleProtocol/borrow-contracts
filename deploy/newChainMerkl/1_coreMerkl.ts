// To be used when deploying governance for the first time on a new chain
import { ChainId, CONTRACTS_ADDRESSES } from '@angleprotocol/sdk';
import { DeployFunction } from 'hardhat-deploy/types';
import yargs from 'yargs';

import { CoreBorrow__factory } from '../../typechain';
const argv = yargs.env('').boolean('ci').parseSync();

const func: DeployFunction = async ({ deployments, ethers, network }) => {
  const { deploy } = deployments;
  const { deployer } = await ethers.getNamedSigners();
  const json = await import('../' + network.name + '.json');
  let governor;
  let guardian;
  const name = 'CoreMerkl';
  const angleLabs = json.angleLabs;
  const deployerGuardian = '0xA9DdD91249DFdd450E81E1c56Ab60E1A62651701'
  const proxyAdmin = (await deployments.get('ProxyAdminAngleLabs')).address;

  governor = angleLabs
  guardian = deployerGuardian

  // TODO: comment if implementation has already been deployed
  console.log('Let us get started with deployment');
  console.log('Now deploying CoreBorrow');
  console.log('Starting with the implementation');
  await deploy('CoreBorrow_Implementation', {
    contract: 'CoreBorrow',
    from: deployer.address,
    log: !argv.ci,
  });

  const coreBorrowImplementation = (await ethers.getContract('CoreBorrow_Implementation')).address;
  console.log(`Successfully deployed the implementation for CoreBorrow at ${coreBorrowImplementation}`);
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

func.tags = ['coreMerkl'];
func.dependencies = ['proxyAdminAngleLabs'];
export default func;
