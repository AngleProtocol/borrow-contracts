import { ChainId, CONTRACTS_ADDRESSES } from '@angleprotocol/sdk';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { formatBytes32String, parseEther } from 'ethers/lib/utils';
import hre from 'hardhat';
import { DeployFunction } from 'hardhat-deploy/types';

import { VaultManager, VaultManager__factory } from '../typechain';
import params from './networks';

const func: DeployFunction = async ({ deployments, ethers, network }) => {
  const json = await import('./networks/' + network.name + '.json');
  const vaultsList = json.vaultsList;
  const governor = json.governor;
  let agTokenAddress: string;
  let signer: SignerWithAddress;
  const stableName = 'GOLD';

  if (!network.live) {
    // If we're in mainnet fork, we're using the `ProxyAdmin` address from mainnet
    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [governor],
    });
    await hre.network.provider.send('hardhat_setBalance', [governor, '0x10000000000000000000000000000']);
    signer = await ethers.getSigner(governor);
    agTokenAddress = CONTRACTS_ADDRESSES[ChainId.MAINNET].agEUR?.AgToken!;

    console.log('Unpausing vaultManager contracts');

    if (params.stablesParameters[stableName].vaultManagers) {
      for (const vaultManagerParams of params.stablesParameters[stableName]?.vaultManagers!) {
        const collat = vaultManagerParams.symbol.split('-')[0];
        const stable = vaultManagerParams.symbol.split('-')[1];
        if (!vaultsList.includes(collat)) continue;
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
        if (!vaultManagerParams.params.borrowFee.isZero()) {
          await (await vaultManager.setUint64(vaultManagerParams.params.borrowFee, formatBytes32String('BF'))).wait();
          console.log(`BorrowFee of ${vaultManagerParams.params.borrowFee} set successfully`);
        }
        if (!vaultManagerParams.params.repayFee.isZero()) {
          await (await vaultManager.setUint64(vaultManagerParams.params.repayFee, formatBytes32String('RF'))).wait();
          console.log(`RepayFee of ${vaultManagerParams.params.repayFee} set successfully`);
        }
        console.log('Setting dusts');
        // if gold: 2 XAU is like 4k agEUR
        await (await vaultManager.setDusts(0, parseEther('4'), parseEther('4'))).wait();
        console.log('Success');
        console.log('');
      }
    }
    console.log('Success, all desired vaultManager contracts have been unpaused and fees have been set');
  }
};

func.tags = ['unpausing'];
func.dependencies = ['governanceSetup'];
export default func;
