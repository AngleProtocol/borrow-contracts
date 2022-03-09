import { ChainId, CONTRACTS_ADDRESSES } from '@angleprotocol/sdk';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import hre from 'hardhat';
import { DeployFunction } from 'hardhat-deploy/types';
import yargs from 'yargs';

import { VaultManager, VaultManager__factory } from '../typechain';
import params from './networks';
const argv = yargs.env('').boolean('ci').parseSync();

const func: DeployFunction = async ({ deployments, ethers, network }) => {
  const { deployer } = await ethers.getNamedSigners();
  const json = await import('./networks/' + network.name + '.json');
  const governor = json.governor;
  let agTokenAddress: string;
  let signer: SignerWithAddress;
  const symbol = ['wETH/agEUR', 'wBTC/agEUR', 'wStETH/agEUR', 'LINK/EUR'];

  if (!network.live) {
    // If we're in mainnet fork, we're using the `ProxyAdmin` address from mainnet
    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [governor],
    });
    await hre.network.provider.send('hardhat_setBalance', [governor, '0x10000000000000000000000000000']);
    signer = await ethers.getSigner(governor);
    agTokenAddress = CONTRACTS_ADDRESSES[ChainId.MAINNET].agEUR?.AgToken!;
  } else {
    // Otherwise, we're using the proxy admin address from the desired network
    signer = deployer;
    agTokenAddress = CONTRACTS_ADDRESSES[network.config.chainId as ChainId].agEUR?.AgToken!;
  }

  console.log('Unpausing vaultManager contracts');

  if (params.stablesParameters.EUR.vaultManagers) {
    for (const vaultManagerParams of params.stablesParameters.EUR.vaultManagers) {
      const collat = vaultManagerParams.symbol.split('/')[0];
      const stable = vaultManagerParams.symbol.split('/')[1];
      const name = `VaultManager_${collat}_${stable}`;

      const vaultManagerAddress = (await deployments.get(name)).address;
      console.log('Now unpausing:', name);
      const vaultManager = (await new ethers.Contract(
        vaultManagerAddress,
        VaultManager__factory.createInterface(),
        signer,
      )) as VaultManager;
      await (await vaultManager.togglePause()).wait();
      console.log('Success');
      console.log('');
    }
  }
  console.log('Success, all desired vaultManager contracts have been unpaused');
};

func.tags = ['unpausing'];
func.dependencies = ['governanceFlashLoan'];
export default func;
