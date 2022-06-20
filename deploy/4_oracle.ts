import { ChainId } from '@angleprotocol/sdk';
import { parseEther } from 'ethers/lib/utils';
import { DeployFunction } from 'hardhat-deploy/types';
import yargs from 'yargs';

const argv = yargs.env('').boolean('ci').parseSync();

const func: DeployFunction = async ({ deployments, web3, ethers, network }) => {
  const { deploy } = deployments;
  const { deployer } = await ethers.getNamedSigners();
  const treasury = (await deployments.get('Treasury')).address;

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
  } else if (network.config.chainId === ChainId.POLYGON) {
    await deploy('Oracle_MATIC_EUR', {
      contract: 'OracleMATICEURChainlinkPolygon',
      from: deployer.address,
      args: [3600 * 48, treasury],
      log: !argv.ci,
    });
    const oracle = (await deployments.get('Oracle_MATIC_EUR')).address;
    console.log(`Successfully deployed Oracle MATIC/EUR at the address ${oracle}`);
    console.log('');
  }
};

func.tags = ['oracle'];
func.dependencies = ['treasury'];
export default func;
