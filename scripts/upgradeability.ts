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

  testUpgradeability('AgEURNameable', 'contracts/agToken/nameable/AgEURNameable.sol');
  testUpgradeability('AgTokenNameable', 'contracts/agToken/nameable/AgTokenNameable.sol');
  testUpgradeability('AgTokenSideChainMultiBridgeNameable', 'contracts/agToken/nameable/AgTokenSideChainMultiBridgeNameable.sol');
  testUpgradeability('TokenPolygonUpgradeableNameable', 'contracts/agToken/nameable/TokenPolygonUpgradeableNameable.sol');

  testStorage(
    'AgEUR',
    'contracts/agToken/AgEUR.sol',
    'AgEURNameable',
    'contracts/agToken/nameable/AgEURNameable.sol',
  );

  testStorage(
    'AgToken',
    'contracts/agToken/AgToken.sol',
    'AgTokenNameable',
    'contracts/agToken/nameable/AgTokenNameable.sol',
  );

  testStorage(
    'AgTokenSideChainMultiBridge',
    'contracts/agToken/AgTokenSideChainMultiBridge.sol',
    'AgTokenSideChainMultiBridgeNameable',
    'contracts/agToken/nameable/AgTokenSideChainMultiBridgeNameable.sol',
  );

  testStorage(
    'TokenPolygonUpgradeable',
    'contracts/agToken/polygon/TokenPolygonUpgradeable.sol',
    'TokenPolygonUpgradeableNameable',
    'contracts/agToken/nameable/TokenPolygonUpgradeableNameable.sol',
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
