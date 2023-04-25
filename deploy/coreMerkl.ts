import { ChainId, CONTRACTS_ADDRESSES, registry } from '@angleprotocol/sdk';
import { DeployFunction } from 'hardhat-deploy/types';
import yargs from 'yargs';

import { expect } from '../test/hardhat/utils/chai-setup';
import { CoreBorrow__factory } from '../typechain';
const argv = yargs.env('').boolean('ci').parseSync();

const func: DeployFunction = async ({ deployments, ethers, network }) => {
  const { deploy } = deployments;
  const { deployer } = await ethers.getNamedSigners();
  const json = await import('./networks/' + network.name + '.json');
  const angleLabs = json.angleLabs;
  const guardian = json.guardian;
  let proxyAdmin: string;
  let implementation: string;
  console.log('Let us get started with deployment');
  if (!network.live || network.config.chainId === ChainId.MAINNET) {
    // If we're in mainnet fork, we're using the `ProxyAdmin` address from mainnet
    proxyAdmin = CONTRACTS_ADDRESSES[ChainId.MAINNET]?.ProxyAdminGuardian!;
    implementation = '0x4D144B7355bC2C33FA091339279e9D77261461fE';
  } else {
    // Otherwise, we're using the proxy admin address from the desired network
    proxyAdmin = registry(network.config.chainId as ChainId)?.ProxyAdminGuardian!;
    try {
      implementation = (await deployments.get('CoreBorrow_Implementation')).address;
    } catch {
      console.log('Now deploying the implementation for CoreBorrow');
      await deploy('CoreBorrow_Implementation', {
        contract: 'CoreBorrow',
        from: deployer.address,
        log: !argv.ci,
      });
      console.log('');
      implementation = (await ethers.getContract('CoreBorrow_Implementation')).address;
    }
  }

  proxyAdmin = '0xE6d9bD6796bDAF9B391Fac2A2D34bAE9c1c3c1C4';

  const coreBorrowInterface = CoreBorrow__factory.createInterface();
  const dataCoreBorrow = new ethers.Contract(implementation, coreBorrowInterface).interface.encodeFunctionData(
    'initialize',
    [angleLabs, guardian],
  );

  console.log('Now deploying the Proxy');
  console.log('The contract will be initialized with the following governor and guardian addresses');
  console.log(angleLabs, guardian);
  console.log(`The proxyAdmin address is ${proxyAdmin}`);

  await deploy('CoreMerkl', {
    contract: 'TransparentUpgradeableProxy',
    from: deployer.address,
    args: [implementation, proxyAdmin, dataCoreBorrow],
    log: !argv.ci,
  });

  const coreMerkl = (await deployments.get('CoreMerkl')).address;
  console.log(`Successfully deployed CoreMerkl at the address ${coreMerkl}`);
};

func.tags = ['coreMerkl'];
export default func;
