import { ChainId, parseAmount, registry } from '@angleprotocol/sdk/dist';
import { BigNumber, Contract } from 'ethers';
import { formatBytes32String, parseEther } from 'ethers/lib/utils';
import hre from 'hardhat';
import { DeployFunction } from 'hardhat-deploy/types';
import yargs from 'yargs';

import { Treasury__factory, VaultManager__factory } from '../../typechain';
const argv = yargs.env('').boolean('ci').parseSync();

const interestRate5 = BigNumber.from('158153934393112649');

const vaultManagers = {
  USD: {
    vaults: [
      {
        collateral: '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0',
        symbol: 'wstETH-USD',
        oracle: 'WSTETH_USD',
        params: {
          debtCeiling: parseEther('1000'),
          collateralFactor: parseAmount.gwei('0.75'),
          targetHealthFactor: parseAmount.gwei('1.05'),
          borrowFee: parseAmount.gwei('0'),
          repayFee: parseAmount.gwei('0'),
          interestRate: interestRate5,
          liquidationSurcharge: parseAmount.gwei('0.98'),
          maxLiquidationDiscount: parseAmount.gwei('0.1'),
          whitelistingActivated: false,
          baseBoost: parseAmount.gwei('1.5'),
          dust: parseEther('0'),
          dustCollateral: parseEther('0'),
          dustLiquidation: parseEther('10'),
        },
      },
    ],
  },
};

const func: DeployFunction = async ({ deployments, ethers, network }) => {
  /**
   * TODO: change implementation depending on what is being deployed
   */
  const implementationName = 'VaultManager_NoDust';
  const implementation = (await ethers.getContract(implementationName)).address;

  /**
   * TODO: set to false if deployer is not admin
   */
  const isDeployerAdmin = true;

  /**
   * TODO: update the vaults list to deploy
   */
  const json = await import('./networks/' + network.name + '.json');
  const vaultsList = json.vaultsList;

  const { deploy } = deployments;
  const { deployer } = await ethers.getNamedSigners();

  const stableName = 'USD';
  if (!network.live || network.config.chainId == 1) {
    // If we're in mainnet fork, we're using the `ProxyAdmin` address from mainnet
    const proxyAdminAddress = registry(ChainId.MAINNET)?.ProxyAdmin!;
    const treasuryAddress = (await deployments.get(`Treasury_${stableName}`)).address;
    console.log(proxyAdminAddress, treasuryAddress);

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
        !vaultManagerParams.params.dust.isZero() &&
        !vaultManagerParams.params.dustLiquidation.isZero() &&
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
  } else {
    console.log('');
    console.log('Not deploying any vault on this chain');
    console.log('');
  }
};

func.tags = ['vaultManagerProxy'];
func.dependencies = ['oracle'];
export default func;
