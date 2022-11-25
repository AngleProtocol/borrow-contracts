import { ChainId, CONTRACTS_ADDRESSES } from '@angleprotocol/sdk/dist';
import { BigNumber, Contract } from 'ethers';
import { deployments, ethers, network } from 'hardhat';

import {
  ProxyAdmin,
  ProxyAdmin__factory,
  VaultManagerLiquidationBoost,
  VaultManagerLiquidationBoost__factory,
} from '../../typechain';

async function main() {
  const { deployer } = await ethers.getNamedSigners();

  const vaultManagerAddress = '0x73aaf8694BA137a7537E7EF544fcf5E2475f227B';

  const implementation = (await deployments.get('VaultManagerNoDust_Implementation')).address;

  const proxyAdminAddress = CONTRACTS_ADDRESSES[ChainId.MAINNET].ProxyAdmin!;

  const proxyAdmin = new Contract(proxyAdminAddress, ProxyAdmin__factory.abi, deployer) as ProxyAdmin;
  const vaultManager = new Contract(
    vaultManagerAddress,
    VaultManagerLiquidationBoost__factory.abi,
    deployer,
  ) as VaultManagerLiquidationBoost;

  const governor = '0xdC4e6DFe07EFCa50a197DF15D9200883eF4Eb1c8';

  await network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [governor],
  });
  await network.provider.send('hardhat_setBalance', [governor, '0x10000000000000000000000000000']);
  const signer = await ethers.getSigner(governor);

  await proxyAdmin.connect(signer).upgrade(vaultManagerAddress, implementation);

  console.log('Upgrade OK');
  console.log(vaultManager.address);

  console.log(await vaultManager.treasury());
  console.log(await vaultManager.collateral());
  console.log(await vaultManager.oracle());
  console.log(await vaultManager.stablecoin());
  console.log((await vaultManager.dust()).toString());
  console.log((await vaultManager.debtCeiling()).toString());
  console.log((await vaultManager.collateralFactor()).toString());
  console.log((await vaultManager.targetHealthFactor()).toString());
  console.log((await vaultManager.borrowFee()).toString());
  console.log((await vaultManager.interestRate()).toString());
  console.log((await vaultManager.liquidationSurcharge()).toString());
  console.log((await vaultManager.maxLiquidationDiscount()).toString());
  console.log((await vaultManager.lastInterestAccumulatorUpdated()).toString());
  console.log((await vaultManager.interestAccumulator()).toString());
  console.log((await vaultManager.totalNormalizedDebt()).toString());
  console.log((await vaultManager.vaultIDCount()).toString());
  console.log(await vaultManager.name());
  console.log(await vaultManager.symbol());

  await vaultManager.connect(signer).setDusts(10, 10);
  console.log((await vaultManager.dust()).toString());

  console.log((await vaultManager.vaultData(8)).collateralAmount.toString());
  console.log((await vaultManager.vaultData(8)).normalizedDebt.toString());
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
