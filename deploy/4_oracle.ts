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
    console.log('Now deploying the Oracle LUSD/EUR');
    await deploy('Oracle_LUSD_EUR', {
      contract: 'OracleLUSDEURChainlink',
      from: deployer.address,
      args: [3600 * 48, treasury],
      log: !argv.ci,
    });
    const oracle = (await deployments.get('Oracle_LUSD_EUR')).address;
    console.log(`Successfully deployed Oracle LUSD/EUR at the address ${oracle}`);
    console.log('');
  } else {
    await deploy('Oracle_MAI_EUR', {
      contract: `OracleMAIEURChainlink${chainName}`,
      from: deployer.address,
      args: [3600 * 48, treasury],
      log: !argv.ci,
    });
    const oracle = (await deployments.get('Oracle_MAI_EUR')).address;
    console.log(`Successfully deployed Oracle MAI/EUR at the address ${oracle}`);
  }
};

func.tags = ['oracle'];
// func.dependencies = ['treasury'];
export default func;
