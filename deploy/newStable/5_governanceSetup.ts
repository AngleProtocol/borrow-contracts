import { ChainId, CONTRACTS_ADDRESSES } from '@angleprotocol/sdk';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import hre from 'hardhat';
import { DeployFunction } from 'hardhat-deploy/types';

import { ProxyAdmin, ProxyAdmin__factory, Treasury, Treasury__factory } from '../../typechain';
import params from './../networks';

const func: DeployFunction = async ({ deployments, ethers, network }) => {
  // This file is only useful in mainnet fork
  const json = await import('./networks/' + network.name + '.json');
  const governor = json.governor;
  let proxyAdminAddress: string;
  let agTokenAddress: string;
  let proxyAdmin: ProxyAdmin;
  let treasuryContract: Treasury;
  let signer: SignerWithAddress;
  const stableName = 'GOLD';

  if (!network.live) {
    proxyAdminAddress = CONTRACTS_ADDRESSES[ChainId.MAINNET].ProxyAdmin!;
    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [governor],
    });
    await hre.network.provider.send('hardhat_setBalance', [governor, '0x10000000000000000000000000000']);
    signer = await ethers.getSigner(governor);
    agTokenAddress = (await deployments.get(`AgToken_${stableName}`)).address;

    const vaultsList = json.vaultsList;
    proxyAdmin = new ethers.Contract(proxyAdminAddress, ProxyAdmin__factory.createInterface(), signer) as ProxyAdmin;
    const treasury = await deployments.get(`Treasury_${stableName}`);
    treasuryContract = new ethers.Contract(treasury.address, Treasury__factory.createInterface(), signer) as Treasury;
    console.log('Setting new vaultManager contracts on the treasury');

    if (params.stablesParameters[stableName].vaultManagers) {
      for (const vaultManagerParams of params.stablesParameters[stableName]?.vaultManagers!) {
        const collat = vaultManagerParams.symbol.split('-')[0];
        const stable = vaultManagerParams.symbol.split('-')[1];
        if (!vaultsList.includes(collat)) continue;
        const name = `VaultManager_${collat}_${stable}`;
        const vaultManagerAddress = (await deployments.get(name)).address;
        console.log(`Now setting ${name} ...`);
        await (await treasuryContract.connect(signer).addVaultManager(vaultManagerAddress)).wait();
        console.log(`Success`);
        console.log('');
      }
    }
  }
};

func.tags = ['governanceSetup'];
func.dependencies = ['vaultManagerProxy'];
export default func;
