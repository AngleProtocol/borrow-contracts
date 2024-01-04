import { ChainId, registry } from '@angleprotocol/sdk';
import { DeployFunction } from 'hardhat-deploy/types';
import yargs from 'yargs';

import { OracleIB01EURChainlink, OracleIB01EURChainlink__factory } from '../../typechain';

const argv = yargs.env('').boolean('ci').parseSync();

const func: DeployFunction = async ({ deployments, ethers, network }) => {
  const { deploy } = deployments;
  const { deployer } = await ethers.getNamedSigners();
  let treasury: string;
  let chainName: string;
  if (!network.live || network.config.chainId == 1) {
    chainName = '';
    treasury = registry(ChainId.MAINNET)?.agEUR?.Treasury!;
  } else {
    chainName = network.name.charAt(0).toUpperCase() + network.name.substring(1);
    treasury = registry(network.config.chainId as ChainId)?.agEUR?.Treasury!;
  }

  console.log('Now deploying the Oracle HIGH/EUR');
  await deploy('Oracle_HIGH_EUR', {
    contract: `OracleHIGHEURChainlink`,
    from: deployer.address,
    // Higher stalePeriod for HIGH
    args: [3600 * 24 * 3, treasury],
    log: !argv.ci,
  });
  const oracle = (await deployments.get('Oracle_HIGH_EUR')).address;
  console.log(`Successfully deployed Oracle HIGH/EUR at the address ${oracle}`);
  console.log('');

  console.log('Now deploying the Oracle IB01/EUR');
  await deploy('Oracle_IB01_EUR', {
    contract: `OracleIB01EURChainlink`,
    from: deployer.address,
    // Higher stalePeriod for IB01
    args: [3600 * 24 * 3, treasury],
    log: !argv.ci,
  });
  const oracle2 = (await deployments.get('Oracle_IB01_EUR')).address;
  console.log(`Successfully deployed Oracle IB01/EUR at the address ${oracle2}`);
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
