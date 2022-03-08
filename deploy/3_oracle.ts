import { ChainId, CONTRACTS_ADDRESSES } from '@angleprotocol/sdk';
import { DeployFunction } from 'hardhat-deploy/types';
import yargs from 'yargs';

import { FlashAngle__factory } from '../typechain';
const argv = yargs.env('').boolean('ci').parseSync();

const func: DeployFunction = async ({ deployments, ethers, network }) => {
  const { deploy } = deployments;
  const { deployer } = await ethers.getNamedSigners();
  const treasury = (await deployments.get('Treasury')).address;

  console.log('Now deploying the Oracle ETH/EUR');
  await deploy('Oracle_ETH_EUR', {
    contract: 'OracleChainlinkMultiTemplate',
    from: deployer.address,
    args: [3600 * 27, treasury],
    log: !argv.ci,
  });
  const oracle = (await deployments.get('Oracle_ETH_EUR')).address;
  console.log(`Successfully deployed Oracle ETH/EUR at the address ${oracle}`);
  console.log('');
};

func.tags = ['oracle'];
func.dependencies = ['treasury'];
export default func;
