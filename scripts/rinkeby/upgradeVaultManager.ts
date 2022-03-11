import { deployments, ethers } from 'hardhat';
import { ChainId, CONTRACTS_ADDRESSES } from '@angleprotocol/sdk';
import { ProxyAdmin, ProxyAdmin__factory } from '../../typechain';

async function main() {
  let proxyAdmin: ProxyAdmin;
  const symbols = ['wETH_EUR', 'wBTC_EUR', 'LINK_EUR'];
  const { deployer } = await ethers.getNamedSigners();
  const proxyAdminAddress = CONTRACTS_ADDRESSES[ChainId.RINKEBY].ProxyAdmin!;
  proxyAdmin = new ethers.Contract(proxyAdminAddress, ProxyAdmin__factory.createInterface(), deployer) as ProxyAdmin;
  const implementationAddress = (await deployments.get('VaultManager_Implementation')).address;
  for (const vaultManagerSymbol of symbols) {
    console.log(`Upgrading VaultManager ${vaultManagerSymbol}`);
    const name = `VaultManager_${vaultManagerSymbol}`;
    const vaultManagerAddress = (await deployments.get(name)).address;
    await (await proxyAdmin.connect(deployer).upgrade(vaultManagerAddress, implementationAddress)).wait();
    console.log('Success');
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
