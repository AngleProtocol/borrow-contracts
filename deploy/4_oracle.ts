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
    console.log('Now deploying the Oracle ETH/EUR');
    await deploy('Oracle_ETH_EUR', {
      contract: 'OracleETHEURChainlink',
      from: deployer.address,
      args: [3600 * 48, treasury],
      log: !argv.ci,
    });
    const oracle = (await deployments.get('Oracle_ETH_EUR')).address;
    console.log(`Successfully deployed Oracle wBTC/EUR at the address ${oracle}`);
    console.log('');
  } else {
    await deploy('Oracle_ETH_EUR', {
      contract: `OracleETHEURChainlink${chainName}`,
      from: deployer.address,
      args: [3600 * 48, treasury],
      log: !argv.ci,
    });
    const oracle = (await deployments.get('Oracle_ETH_EUR')).address;
    console.log(`Successfully deployed Oracle ETH/EUR at the address ${oracle}`);
    console.log('');
    await deploy('Oracle_MATIC_EUR', {
      contract: `OracleMATICEURChainlink${chainName}`,
      from: deployer.address,
      args: [3600 * 48, treasury],
      log: !argv.ci,
    });
    const oracle2 = (await deployments.get('Oracle_MATIC_EUR')).address;
    console.log(`Successfully deployed Oracle MATIC/EUR at the address ${oracle2}`);
    console.log('');
    await deploy('Oracle_USDC_EUR', {
      contract: `OracleUSDCEURChainlink${chainName}`,
      from: deployer.address,
      args: [3600 * 48, treasury],
      log: !argv.ci,
    });
    const oracle3 = (await deployments.get('Oracle_USDC_EUR')).address;
    console.log(`Successfully deployed Oracle USDC/EUR at the address ${oracle3}`);
    console.log('');
  }
};

func.tags = ['oracle'];
// func.dependencies = ['treasury'];
export default func;
