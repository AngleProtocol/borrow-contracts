import { deployments, ethers } from 'hardhat';
import { VaultManager, VaultManager__factory, FlashAngle, FlashAngle__factory } from '../../typechain';
import { CONSTANTS } from '@angleprotocol/sdk';
// import params from '../../deploy/networks';
import { expect } from '../../test/utils/chai-setup';
import { parseEther } from 'ethers/lib/utils';

async function main() {
  let vaultManager: VaultManager;
  let flashAngle: FlashAngle;
  const { deployer } = await ethers.getNamedSigners();
  const params = CONSTANTS(1);
  if (params.stablesParameters.EUR.vaultManagers) {
    for (const vaultManagerParams of params.stablesParameters.EUR.vaultManagers) {
      const collat = vaultManagerParams.symbol.split('-')[0];
      const stable = vaultManagerParams.symbol.split('-')[1];
      const name = `VaultManager_${collat}_${stable}`;
      console.log(`Looking at the params of VaultManager ${vaultManagerParams.symbol}`);
      const vaultManagerAddress = (await deployments.get(name)).address;

      vaultManager = new ethers.Contract(
        vaultManagerAddress,
        VaultManager__factory.createInterface(),
        deployer,
      ) as VaultManager;
      expect(await vaultManager.debtCeiling()).to.be.equal(vaultManagerParams.params.debtCeiling);
      expect(await vaultManager.collateralFactor()).to.be.equal(vaultManagerParams.params.collateralFactor);
      expect(await vaultManager.targetHealthFactor()).to.be.equal(vaultManagerParams.params.targetHealthFactor);
      expect(await vaultManager.borrowFee()).to.be.equal(vaultManagerParams.params.borrowFee);
      expect(await vaultManager.repayFee()).to.be.equal(vaultManagerParams.params.repayFee);
      expect(await vaultManager.interestRate()).to.be.equal(vaultManagerParams.params.interestRate);
      expect(await vaultManager.liquidationSurcharge()).to.be.equal(vaultManagerParams.params.liquidationSurcharge);
      expect(await vaultManager.yLiquidationBoost(0)).to.be.equal(vaultManagerParams.params.baseBoost);
      expect(await vaultManager.whitelistingActivated()).to.be.equal(vaultManagerParams.params.whitelistingActivated);
      expect(await vaultManager.dust()).to.be.equal(parseEther('10000'));

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
      console.log((await vaultManager.dust()).toString());
    }
    const flashAngleAddress = (await deployments.get('FlashAngle')).address;
    flashAngle = new ethers.Contract(flashAngleAddress, FlashAngle__factory.createInterface(), deployer) as FlashAngle;
    console.log('Flash loan and core');
    console.log((await deployments.get('CoreBorrow')).address);
    console.log(await flashAngle.core());
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
