import { ChainId, registry } from '@angleprotocol/sdk';
import { DeployFunction } from 'hardhat-deploy/types';
import yargs from 'yargs';

import { OracleIB01EURChainlink, OracleIB01EURChainlink__factory } from '../typechain';

const argv = yargs.env('').boolean('ci').parseSync();

const func: DeployFunction = async ({ deployments, ethers, network }) => {
  const { deploy } = deployments;
  const { deployer } = await ethers.getNamedSigners();
  const stableName = 'EUR';
  // const treasury = (await deployments.get(`Treasury_${stableName}`)).address;
  let treasury: string;
  let chainName: string;
  if (!network.live || network.config.chainId == 1) {
    chainName = '';
    treasury = registry(ChainId.MAINNET)?.agEUR?.Treasury!;
  } else {
    chainName = network.name.charAt(0).toUpperCase() + network.name.substring(1);
    treasury = registry(network.config.chainId as ChainId)?.agEUR?.Treasury!;
  }

  console.log('Now deploying the Oracle IB01/EUR');
  await deploy('Oracle_IB01_EUR', {
    contract: `OracleIB01EURChainlink`,
    from: deployer.address,
    args: [3600 * 30, treasury],
    log: !argv.ci,
  });
  const oracle = (await deployments.get('Oracle_IB01_EUR')).address;
  console.log(`Successfully deployed Oracle IB01/EUR at the address ${oracle}`);
  console.log('');

  await deploy('Oracle_USDC_EUR', {
    contract: `OracleUSDCEURChainlink`,
    from: deployer.address,
    args: [3600 * 30, treasury],
    log: !argv.ci,
  });
  const oracle2 = (await deployments.get('Oracle_USDC_EUR')).address;
  console.log(`Successfully deployed Oracle USDC/EUR at the address ${oracle2}`);
  console.log('');

  const oracleContract = new ethers.Contract(
    oracle,
    OracleIB01EURChainlink__factory.createInterface(),
    deployer,
  ) as OracleIB01EURChainlink;

  const oracleContract2 = new ethers.Contract(
    oracle2,
    OracleIB01EURChainlink__factory.createInterface(),
    deployer,
  ) as OracleIB01EURChainlink;

  const oracleValue = await oracleContract.read();
  console.log(oracleValue.toString());

  const oracleValue2 = await oracleContract2.read();
  console.log(oracleValue2.toString());
};

func.tags = ['oracle'];
// func.dependencies = ['treasury'];
export default func;
