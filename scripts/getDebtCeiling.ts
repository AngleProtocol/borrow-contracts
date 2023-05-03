import { ChainId, formatAmount, registry } from '@angleprotocol/sdk';
import { ethers, network } from 'hardhat';

import { Treasury, Treasury__factory, VaultManager, VaultManager__factory } from '../typechain';

async function main() {
  const { deployer } = await ethers.getNamedSigners();
  const treasuryAddress = registry(network.config.chainId as ChainId)?.agEUR?.Treasury!;

  const treasury = new ethers.Contract(treasuryAddress, Treasury__factory.createInterface(), deployer) as Treasury;
  let result = true;
  let i = 0;
  while (result) {
    try {
      const address = await treasury.vaultManagerList(i);
      console.log(`Address ${i}: ${address}`);
      const vaultManager = new ethers.Contract(
        address,
        VaultManager__factory.createInterface(),
        deployer,
      ) as VaultManager;
      const debt = await vaultManager.getTotalDebt();
      const ceiling = await vaultManager.debtCeiling();
      console.log(await vaultManager.name(), formatAmount.ether(debt), formatAmount.ether(ceiling));
      console.log(formatAmount.ether(ceiling.sub(debt)));
    } catch {
      result = false;
    }
    i++;
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
