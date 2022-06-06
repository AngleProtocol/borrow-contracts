import { deployments, ethers } from 'hardhat';
import { VaultManager, VaultManager__factory } from '../../typechain';

async function main() {
  let vaultManager: VaultManager;
  const symbols = ['wETH_EUR', 'wStETH_EUR', 'wBTC_EUR'];
  const { deployer } = await ethers.getNamedSigners();
  for (const vaultManagerSymbol of symbols) {
    console.log(`Looking at the params of VaultManager ${vaultManagerSymbol}`);
    const name = `VaultManager_${vaultManagerSymbol}`;
    const vaultManagerAddress = (await deployments.get(name)).address;
    vaultManager = new ethers.Contract(
      vaultManagerAddress,
      VaultManager__factory.createInterface(),
      deployer,
    ) as VaultManager;
    console.log((await vaultManager.debtCeiling()).toString());
    console.log((await vaultManager.collateralFactor()).toString());
    console.log((await vaultManager.targetHealthFactor()).toString());
    console.log((await vaultManager.borrowFee()).toString());
    console.log((await vaultManager.repayFee()).toString());
    console.log((await vaultManager.interestRate()).toString());
    console.log((await vaultManager.liquidationSurcharge()).toString());
    console.log((await vaultManager.maxLiquidationDiscount()).toString());
    console.log((await vaultManager.yLiquidationBoost(0)).toString());
    console.log((await vaultManager.whitelistingActivated()).toString());
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
