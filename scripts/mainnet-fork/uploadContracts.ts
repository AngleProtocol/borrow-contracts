import { artifacts, ethers } from 'hardhat';

async function main() {
  // const list = await artifacts.getAllFullyQualifiedNames();
  const list = ['contracts/vaultManager/VaultManager.sol:VaultManager'];
  for (const fqn of list) {
    console.log(fqn);
    const buildInfo = await artifacts.getBuildInfo(fqn);
    await ethers.provider.send('hardhat_addCompilationResult', [
      buildInfo?.solcVersion,
      buildInfo?.input,
      buildInfo?.output,
    ]);
  }
}

main();
