import { ChainId, registry } from '@angleprotocol/sdk';
import { DeployFunction } from 'hardhat-deploy/types';
import yargs from 'yargs';

import { OracleWSTETHUSDChainlink, OracleWSTETHUSDChainlink__factory } from '../../typechain';

const argv = yargs.env('').boolean('ci').parseSync();

const func: DeployFunction = async ({ deployments, ethers, network }) => {
  const { deploy } = deployments;
  const { deployer } = await ethers.getNamedSigners();
  const stableName = 'USD';
  if (!network.live || network.config.chainId == 1) {
    const treasury = (await deployments.get(`Treasury_${stableName}`)).address;
    console.log('Now deploying the Oracle wstETH/USD');
    await deploy('Oracle_WSTETH_USD', {
      contract: `OracleWSTETHUSDChainlink`,
      from: deployer.address,
      args: [3600 * 24, treasury],
      log: !argv.ci,
    });
    const oracle = (await deployments.get('Oracle_WSTETH_USD')).address;
    console.log(`Successfully deployed Oracle wstETH/USD at the address ${oracle}`);
    console.log('');

    const oracleContract = new ethers.Contract(
      oracle,
      OracleWSTETHUSDChainlink__factory.createInterface(),
      deployer,
    ) as OracleWSTETHUSDChainlink;

    const oracleValue = await oracleContract.read();
    console.log(oracleValue.toString());
  } else {
    console.log(`Not deploying anything on ${network.name}`);
  }
};

func.tags = ['oracleStablecoin'];
func.dependencies = ['treasuryStablecoin'];
export default func;
