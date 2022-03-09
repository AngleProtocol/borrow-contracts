import { DeployFunction } from 'hardhat-deploy/types';
import { ChainId } from '@angleprotocol/sdk';
import yargs from 'yargs';
import { parseEther } from 'ethers/lib/utils';

const argv = yargs.env('').boolean('ci').parseSync();

const func: DeployFunction = async ({ deployments, ethers, network }) => {
  const { deploy } = deployments;
  const { deployer } = await ethers.getNamedSigners();
  const treasury = (await deployments.get('Treasury')).address;

  // TODO Work needed here for rinkeby

  if (network.config.chainId != ChainId.RINKEBY) {
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
  } else {
    const json = await import('./networks/' + network.name + '.json');
    console.log('Now deploying the Oracle BTC/EUR');
    await deploy('Oracle_BTC_EUR', {
      contract: 'OracleChainlinkMulti',
      from: deployer.address,
      args: [
        [json.Chainlink['BTC/USD'], json.Chainlink['EUR/USD']],
        [1, 0],
        parseEther('1'),
        3600 * 48,
        treasury,
        'OracleBTCEUR',
      ],
      log: !argv.ci,
    });
    const oracle1 = (await deployments.get('Oracle_BTC_EUR')).address;
    console.log(`Successfully deployed Oracle BTC/EUR at the address ${oracle1}`);
    console.log('');
    console.log('Now deploying the Oracle LINK/EUR');
    await deploy('Oracle_LINK_EUR', {
      contract: 'OracleChainlinkMulti',
      from: deployer.address,
      args: [
        [json.Chainlink['LINK/USD'], json.Chainlink['EUR/USD']],
        [1, 0],
        parseEther('1'),
        3600 * 48,
        treasury,
        'OracleLINKEUR',
      ],
      log: !argv.ci,
    });
    const oracle2 = (await deployments.get('Oracle_LINK_EUR')).address;
    console.log(`Successfully deployed Oracle LINK/EUR at the address ${oracle2}`);
    console.log('');
  }
};

func.tags = ['oracle'];
func.dependencies = ['treasury'];
export default func;
