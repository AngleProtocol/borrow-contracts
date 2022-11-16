import { UpgradeableContract } from '@openzeppelin/upgrades-core';
import { artifacts } from 'hardhat';

const testUpgradeability = async (name: string, file: string) => {
  const buildInfo = await artifacts.getBuildInfo(`${file}:${name}`);
  const baseContract = new UpgradeableContract(name, buildInfo?.input as any, buildInfo?.output as any);
  console.log(name);
  console.log(baseContract.getErrorReport().explain());
  console.log('');
};

const testStorage = async (name: string, file: string, nameUpgrade: string, fileUpgrade: string) => {
  const buildInfo = await artifacts.getBuildInfo(`${file}:${name}`);
  const baseContract = new UpgradeableContract(name, buildInfo?.input as any, buildInfo?.output as any);

  const upgradeBuildInfo = await artifacts.getBuildInfo(`${fileUpgrade}:${nameUpgrade}`);
  const upgradeContract = new UpgradeableContract(
    nameUpgrade,
    upgradeBuildInfo?.input as any,
    upgradeBuildInfo?.output as any,
  );
  console.log('Upgrade Testing');
  console.log(baseContract.getStorageUpgradeReport(upgradeContract).explain());
  console.log('Done');
};

async function main() {
  // Uncomment to check all valid build names
  // console.log((await artifacts.getAllFullyQualifiedNames()));

  testUpgradeability('VaultManagerLiquidationBoost', 'contracts/vaultManager/VaultManagerLiquidationBoost.sol');
  testUpgradeability('OldVaultManager', 'contracts/deprecated/OldVaultManager.sol');
  testUpgradeability('OldAngleHelpers', 'contracts/deprecated/OldAngleHelpers.sol');
  testUpgradeability('AngleHelpers', 'contracts/ui-helpers/AngleHelpers.sol');

  testStorage(
    'OldVaultManager',
    'contracts/deprecated/OldVaultManager.sol',
    'VaultManagerLiquidationBoost',
    'contracts/vaultManager/VaultManagerLiquidationBoost.sol',
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
