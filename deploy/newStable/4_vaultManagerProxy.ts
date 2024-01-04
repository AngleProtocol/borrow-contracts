import { ChainId, registry } from '@angleprotocol/sdk/dist';
import { Contract } from 'ethers';
import { formatBytes32String } from 'ethers/lib/utils';
import hre from 'hardhat';
import { DeployFunction } from 'hardhat-deploy/types';
import yargs from 'yargs';

import { Treasury__factory, VaultManager__factory } from '../../typechain';
import { forkedChain, forkedChainName, stableName, vaultManagers, vaultsList } from '../constants/constants';
const argv = yargs.env('').boolean('ci').parseSync();

const func: DeployFunction = async ({ deployments, ethers, network }) => {
  /**
   * TODO: change implementation depending on what is being deployed
   */
  const implementationName = 'VaultManager_NoDust';

  /**
   * TODO: set to false if deployer is not admin
   */
  const isDeployerAdmin = true;

  /**
   * TODO: make sure that the vaultsList to deploy is updated
   */

  const { deploy } = deployments;
  const { deployer } = await ethers.getNamedSigners();

  if ((!network.live && (forkedChain as ChainId) == ChainId.MAINNET) || network.config.chainId == 1) {
    let implementation: string;
    try {
      implementation = (await ethers.getContract(implementationName)).address;
    } catch {
      // Typically if we're in mainnet fork
      console.log('Now deploying VaultManager implementation');
      await deploy(implementationName, {
        contract: 'VaultManagerLiquidationBoost',
        from: deployer.address,
        args: [],
        log: !argv.ci,
      });
      implementation = (await ethers.getContract(implementationName)).address;
    }
    // If we're in mainnet fork, we're using the `ProxyAdmin` address from mainnet
    const proxyAdminAddress = registry(ChainId.MAINNET)?.ProxyAdmin!;
    const treasuryAddress = (await deployments.get(`Treasury_${stableName}`)).address;
    console.log(`Treasury: ${treasuryAddress}`);

    console.log(`Deploying proxies for the following vaultManager: ${vaultsList}`);

    for (const vaultManagerParams of vaultManagers[stableName]?.vaults!) {
      const collat = vaultManagerParams.symbol.split('-')[0];
      const stable = vaultManagerParams.symbol.split('-')[1];
      if (!vaultsList.includes(collat)) continue;
      const name = `VaultManager_${collat}_${stable}`;
      const oracle = (await ethers.getContract(`Oracle_${vaultManagerParams.oracle}`)).address;

      console.log('Now deploying the Proxy for:', name);
      console.log(`The params for this vaultManager are:`);
      console.log(`collateral: ${vaultManagerParams.collateral}`);
      console.log(`oracle address: ${oracle}`);
      console.log(`symbol: ${vaultManagerParams.symbol}`);
      console.log(`debtCeiling: ${vaultManagerParams.params.debtCeiling.toString()}`);
      console.log(`collateralFactor: ${vaultManagerParams.params.collateralFactor.toString()}`);
      console.log(`targetHealthFactor: ${vaultManagerParams.params.targetHealthFactor.toString()}`);
      console.log(`borrowFee: ${vaultManagerParams.params.borrowFee.toString()}`);
      console.log(`repayFee: ${vaultManagerParams.params.repayFee.toString()}`);
      console.log(`interestRate: ${vaultManagerParams.params.interestRate.toString()}`);
      console.log(`liquidationSurcharge: ${vaultManagerParams.params.liquidationSurcharge.toString()}`);
      console.log(`maxLiquidationDiscount: ${vaultManagerParams.params.maxLiquidationDiscount.toString()}`);
      console.log(`baseBoost: ${vaultManagerParams.params.baseBoost.toString()}`);
      console.log(`whitelistingActivated: ${vaultManagerParams.params.whitelistingActivated.toString()}`);
      console.log('');

      const treasury = new Contract(treasuryAddress, Treasury__factory.abi, deployer);

      const callData = new ethers.Contract(
        implementation,
        VaultManager__factory.createInterface(),
      ).interface.encodeFunctionData('initialize', [
        treasury.address,
        vaultManagerParams.collateral,
        oracle,
        vaultManagerParams.params,
        vaultManagerParams.symbol,
      ]);
      await deploy(name, {
        contract: 'TransparentUpgradeableProxy',
        from: deployer.address,
        args: [implementation, proxyAdminAddress, callData],
        log: !argv.ci,
      });

      const vaultManagerAddress = (await deployments.get(name)).address;
      const vaultManager = new Contract(vaultManagerAddress, VaultManager__factory.abi, deployer);
      console.log(`Successfully deployed ${name} at the address ${vaultManagerAddress}`);
      console.log(`${vaultManagerAddress} ${implementation} ${proxyAdminAddress} ${callData}`);
      console.log('');

      let signer = deployer;
      if (!isDeployerAdmin) {
        const json = await import('./networks/' + network.name + '.json');
        const governor = json.governor;

        await hre.network.provider.request({
          method: 'hardhat_impersonateAccount',
          params: [governor],
        });
        await hre.network.provider.send('hardhat_setBalance', [governor, '0x10000000000000000000000000000']);
        signer = await ethers.getSigner(governor);
      }

      console.log(`Now adding ${name} to the VaultManager`);
      await (await treasury.connect(signer).addVaultManager(vaultManagerAddress)).wait();
      console.log(`Success`);

      console.log('Unpausing vaultManager');
      await (await vaultManager.togglePause()).wait();
      console.log('Success');

      // Set borrowFee and repayFee if needed
      if (!vaultManagerParams.params.borrowFee.isZero()) {
        await (
          await vaultManager.connect(signer).setUint64(vaultManagerParams.params.borrowFee, formatBytes32String('BF'))
        ).wait();
        console.log(`BorrowFee of ${vaultManagerParams.params.borrowFee} set successfully`);
      }
      if (!vaultManagerParams.params.repayFee.isZero()) {
        await (
          await vaultManager.connect(signer).setUint64(vaultManagerParams.params.repayFee, formatBytes32String('RF'))
        ).wait();
        console.log(`RepayFee of ${vaultManagerParams.params.repayFee} set successfully`);
      }
      if (
        !vaultManagerParams.params.dust.isZero() ||
        !vaultManagerParams.params.dustLiquidation.isZero() ||
        !vaultManagerParams.params.dustCollateral.isZero()
      ) {
        console.log('Setting dusts');
        await (
          await vaultManager
            .connect(signer)
            .setDusts(
              vaultManagerParams.params.dust,
              vaultManagerParams.params.dustLiquidation,
              vaultManagerParams.params.dustCollateral,
            )
        ).wait();
        console.log('Success');
      }
    }
    console.log('Proxy deployments done');
    console.log('');
  } else {
    console.log(`Not deploying any vault on ${forkedChainName}`);
    console.log('');
  }
};

func.tags = ['vaultNewStable'];
func.dependencies = ['oracleNewStable'];
export default func;
