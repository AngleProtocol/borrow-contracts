import { ChainId } from '@angleprotocol/sdk';
import { parseEther } from 'ethers/lib/utils';
import { DeployFunction } from 'hardhat-deploy/types';
import yargs from 'yargs';

const argv = yargs.env('').boolean('ci').parseSync();

const func: DeployFunction = async ({ deployments, web3, ethers, network }) => {
  const { deploy } = deployments;
  const { deployer } = await ethers.getNamedSigners();
  const treasury = (await deployments.get('Treasury')).address;

  const chainName = network.name.charAt(0).toUpperCase() + network.name.substring(1);

  if (!network.live || network.config.chainId === ChainId.MAINNET) {
    console.log('Now deploying the Oracle CBETH/EUR');
    await deploy('Oracle_CBETH_EUR', {
      contract: 'OracleCBETHEURChainlink',
      from: deployer.address,
      args: [3600 * 48, treasury],
      log: !argv.ci,
    });
    const oracle = (await deployments.get('Oracle_CBETH_EUR')).address;
    console.log(`Successfully deployed Oracle CBETH/EUR at the address ${oracle}`);
    console.log('');
  } else {
    await deploy('Oracle_AVAX_EUR', {
      contract: `OracleAVAXEURChainlink${chainName}`,
      from: deployer.address,
      args: [3600 * 48, treasury],
      log: !argv.ci,
    });
    const oracle = (await deployments.get('Oracle_AVAX_EUR')).address;
    console.log(`Successfully deployed Oracle AVAX/EUR at the address ${oracle}`);

    await deploy('Oracle_USDC_EUR', {
      contract: `OracleUSDCEURChainlink${chainName}`,
      from: deployer.address,
      args: [3600 * 48, treasury],
      log: !argv.ci,
    });
    const oracle2 = (await deployments.get('Oracle_USDC_EUR')).address;
    console.log(`Successfully deployed Oracle USDC/EUR at the address ${oracle2}`);
  }
};

func.tags = ['oracle'];
// func.dependencies = ['treasury'];
export default func;
