import { ChainId, CONTRACTS_ADDRESSES } from '@angleprotocol/sdk';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import hre from 'hardhat';
import { DeployFunction } from 'hardhat-deploy/types';
import { formatBytes32String } from 'ethers/lib/utils';
import yargs from 'yargs';

import { VaultManager, VaultManager__factory } from '../typechain';
import params from './networks';

const func: DeployFunction = async ({ deployments, ethers, network }) => {
  const { deployer } = await ethers.getNamedSigners();
  const json = await import('./networks/' + network.name + '.json');
  const governor = json.governor;
  let agTokenAddress: string;
  let signer: SignerWithAddress;
  const symbols = ['wETH/EUR', 'wBTC/EUR', 'LINK/EUR'];

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
      if (vaultManagerParams.symbol in symbols) {
        console.log('Supported VaultManager');
        // This is an example to show that we can filter vaultManager contracts by their symbol
      }
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

      // Set borrowFee and repayFee if needed
      if(!vaultManagerParams.params.borrowFee.isZero()){
        await (await vaultManager.setUint64(vaultManagerParams.params.borrowFee, formatBytes32String('BF'))).wait();
        console.log(`BorrowFee of ${vaultManagerParams.params.borrowFee} set successfully`);
      }
      if(!vaultManagerParams.params.repayFee.isZero()){
        await (await vaultManager.setUint64(vaultManagerParams.params.repayFee, formatBytes32String('RF'))).wait();
        console.log(`RepayFee of ${vaultManagerParams.params.repayFee} set successfully`);
      }
      console.log('');
    }
  }
  console.log('Success, all desired vaultManager contracts have been unpaused');
};

func.tags = ['unpausing'];
func.dependencies = ['governanceFlashLoan'];
export default func;
