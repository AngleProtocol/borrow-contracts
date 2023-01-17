import { ChainId, CONTRACTS_ADDRESSES } from '@angleprotocol/sdk';
import { DeployFunction } from 'hardhat-deploy/types';
import yargs from 'yargs';

import { SanFRAXEURERC4626AdapterStakable__factory } from '../typechain';

const argv = yargs.env('').boolean('ci').parseSync();

const func: DeployFunction = async ({ deployments, ethers, network }) => {
  const { deploy } = deployments;
  const { deployer } = await ethers.getNamedSigners();
  let proxyAdmin: string;

  // This is the only element that needs to be changed
  const adapterName = 'SanFRAXEURERC4626AdapterStakable';

  if (!network.live || network.config.chainId == 1) {
    // If we're in mainnet fork, we're using the `ProxyAdmin` address from mainnet
    proxyAdmin = CONTRACTS_ADDRESSES[ChainId.MAINNET]?.ProxyAdmin!;
  } else {
    // Otherwise, we're using the proxy admin address from the desired network and the newly deployed agToken
    proxyAdmin = (await ethers.getContract('ProxyAdmin')).address;
  }

  console.log(`Now deploying the ${adapterName} implementation`);

  await deploy(`${adapterName}_Implementation`, {
    contract: adapterName,
    from: deployer.address,
    args: [],
    log: !argv.ci,
  });

  const adapterImplementation = (await deployments.get(`${adapterName}_Implementation`)).address;
  console.log(`Successfully deployed the implementation at ${adapterImplementation}`);

  // Interface works for any type of adapter
  const adapterInterface = SanFRAXEURERC4626AdapterStakable__factory.createInterface();
  const dataAdapter = new ethers.Contract(adapterImplementation, adapterInterface).interface.encodeFunctionData(
    'initialize',
    [],
  );
  await deploy(adapterName, {
    contract: 'TransparentUpgradeableProxy',
    from: deployer.address,
    log: !argv.ci,
    args: [adapterImplementation, proxyAdmin, dataAdapter],
  });
  const address = (await ethers.getContract(adapterName)).address;

  console.log(`Successfully deployed the proxy for ${adapterName} at ${address}`);
  console.log('');
};

func.tags = ['sanTokenAdapter'];
export default func;
