import { ChainId, CONTRACTS_ADDRESSES } from '@angleprotocol/sdk';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import hre from 'hardhat';
import { DeployFunction } from 'hardhat-deploy/types';
import { AgToken, AgToken__factory, ProxyAdmin, ProxyAdmin__factory, Treasury, Treasury__factory } from '../typechain';
import params from './networks';

const func: DeployFunction = async ({ deployments, ethers, network }) => {
  const { deployer } = await ethers.getNamedSigners();
  const json = await import('./networks/' + network.name + '.json');
  const governor = json.governor;
  let proxyAdminAddress: string;
  let agTokenAddress: string;
  let proxyAdmin: ProxyAdmin;
  let treasuryContract: Treasury;
  let signer: SignerWithAddress;
  let agToken: AgToken;

  const stableName = 'EUR';

  if (!network.live) {
    // If we're in mainnet fork, we're using the `ProxyAdmin` address from mainnet
    proxyAdminAddress = CONTRACTS_ADDRESSES[ChainId.MAINNET].ProxyAdmin!;
    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [governor],
    });
    await hre.network.provider.send('hardhat_setBalance', [governor, '0x10000000000000000000000000000']);
    signer = await ethers.getSigner(governor);
    agTokenAddress = CONTRACTS_ADDRESSES[ChainId.MAINNET].agEUR?.AgToken!;
  } else {
    // Otherwise, we're using the proxy admin address from the desired network
    proxyAdminAddress = CONTRACTS_ADDRESSES[network.config.chainId as ChainId].ProxyAdmin!;
    signer = deployer;
    agTokenAddress = (await deployments.get(`AgToken_${stableName}`)).address;
  }
  const vaultsList = json.vaultsList;
  proxyAdmin = new ethers.Contract(proxyAdminAddress, ProxyAdmin__factory.createInterface(), signer) as ProxyAdmin;
  const treasury = await deployments.get('Treasury');
  treasuryContract = new ethers.Contract(treasury.address, Treasury__factory.createInterface(), signer) as Treasury;

  if (!network.live) {
    // We're just upgrading the agToken in mainnet fork
    console.log('Upgrading AgToken');
    const agTokenImplementation = await deployments.get('AgToken_Implementation');
    await (await proxyAdmin.connect(signer).upgrade(agTokenAddress, agTokenImplementation.address)).wait();
    console.log('Success');
    console.log('');
    agToken = new ethers.Contract(agTokenAddress, AgToken__factory.createInterface(), deployer) as AgToken;

    console.log('Setting up the treasury on the agToken');
    await (await agToken.connect(signer).setUpTreasury(treasury.address)).wait();
    console.log('Success');
    console.log('');
  }
  if (!network.live || network.config.chainId != 1) {
    console.log('Setting new vaultManager contracts on the treasury');

    if (params.stablesParameters.EUR.vaultManagers) {
      for (const vaultManagerParams of params.stablesParameters.EUR.vaultManagers) {
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
func.dependencies = ['swapper'];
export default func;
