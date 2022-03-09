import { ChainId, CONTRACTS_ADDRESSES } from '@angleprotocol/sdk/dist';
import hre from 'hardhat';
import { DeployFunction } from 'hardhat-deploy/types';
import yargs from 'yargs';

import { VaultManager__factory } from '../typechain';
import params from './networks';
const argv = yargs.env('').boolean('ci').parseSync();

const func: DeployFunction = async ({ deployments, ethers, network }) => {
  const { deploy } = deployments;
  const { deployer } = await ethers.getNamedSigners();
  let proxyAdminAddress: string;
  const implementation = (await ethers.getContract('VaultManager_Implementation')).address;
  const treasury = (await ethers.getContract('Treasury')).address;

  if (!network.live) {
    // If we're in mainnet fork, we're using the `ProxyAdmin` address from mainnet
    proxyAdminAddress = CONTRACTS_ADDRESSES[ChainId.MAINNET].ProxyAdmin!;
  } else {
    // Otherwise, we're using the proxy admin address from the desired network
    proxyAdminAddress = CONTRACTS_ADDRESSES[network.config.chainId as ChainId].ProxyAdmin!;
  }

  console.log('Deploying proxies for vaultManager');

  if (params.stablesParameters.EUR.vaultManagers) {
    for (const vaultManagerParams of params.stablesParameters.EUR.vaultManagers) {
      const collat = vaultManagerParams.symbol.split('/')[0];
      const stable = vaultManagerParams.symbol.split('/')[1];
      const name = `VaultManager_${collat}_${stable}`;
      const oracle = (await ethers.getContract(`Oracle_${vaultManagerParams.oracle}`)).address;

      console.log('Now deploying the Proxy for:', name);
      const callData = new ethers.Contract(
        implementation,
        VaultManager__factory.createInterface(),
      ).interface.encodeFunctionData('initialize', [
        treasury,
        vaultManagerParams.collateral,
        oracle,
        vaultManagerParams.params,
        vaultManagerParams.symbol,
      ]);

      await deploy(name, {
        contract: 'TransparentUpgradeableProxy',
        from: deployer.address,
        args: [implementation, proxyAdminAddress, callData],
        log: !argv.ci,
      });

      const vaultManagerAddress = (await deployments.get(name)).address;
      console.log(`Successfully deployed ${name} at the address ${vaultManagerAddress}`);
      console.log('');
    }
  }

  console.log('Proxy deployments done');
};

func.tags = ['vaultManagerProxy'];
func.dependencies = ['vaultManagerImplementation'];
export default func;
