import { ChainId, CONTRACTS_ADDRESSES } from '@angleprotocol/sdk/dist';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { Contract } from 'ethers';
import hre from 'hardhat';
import { DeployFunction } from 'hardhat-deploy/types';
import yargs from 'yargs';

import { Treasury__factory, VaultManager__factory } from '../typechain';
import params from './networks';
const argv = yargs.env('').boolean('ci').parseSync();

const func: DeployFunction = async ({ deployments, ethers, network }) => {
  const { deploy } = deployments;
  const { deployer } = await ethers.getNamedSigners();
  const json = await import('./networks/' + network.name + '.json');
  const governor = json.governor;

  let proxyAdminAddress: string;
  const implementation = (await ethers.getContract('VaultManager_Implementation')).address;
  const treasuryAddress = (await ethers.getContract('Treasury')).address;
  let signer: SignerWithAddress;

  if (!network.live) {
    // If we're in mainnet fork, we're using the `ProxyAdmin` address from mainnet
    proxyAdminAddress = CONTRACTS_ADDRESSES[ChainId.MAINNET].ProxyAdmin!;
    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [governor],
    });
    await hre.network.provider.send('hardhat_setBalance', [governor, '0x10000000000000000000000000000']);
    signer = await ethers.getSigner(governor);
  } else {
    // Otherwise, we're using the proxy admin address from the desired network
    proxyAdminAddress = CONTRACTS_ADDRESSES[network.config.chainId as ChainId].ProxyAdmin!;
    signer = deployer;
  }

  const treasury = new Contract(treasuryAddress, Treasury__factory.abi, signer);

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
        treasury.address,
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
