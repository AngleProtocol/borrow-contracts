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
    console.log('Now deploying the Oracle wBTC/EUR');
    await deploy('Oracle_BTC_EUR', {
      contract: 'OracleBTCEURChainlink',
      from: deployer.address,
      args: [3600 * 48, treasury],
      log: !argv.ci,
    });
    const oracle2 = (await deployments.get('Oracle_BTC_EUR')).address;
    console.log(`Successfully deployed Oracle BTC/EUR at the address ${oracle2}`);
    console.log('');
    console.log('Now deploying the Oracle WSTETH/EUR');
    await deploy('Oracle_WSTETH_EUR', {
      contract: 'OracleWSTETHEURChainlink',
      from: deployer.address,
      args: [3600 * 48, treasury],
      log: !argv.ci,
    });
    const oracle3 = (await deployments.get('Oracle_WSTETH_EUR')).address;
    console.log(`Successfully deployed Oracle wStETH/EUR at the address ${oracle3}`);
    console.log('');
  } else if (network.config.chainId === ChainId.RINKEBY) {
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
        web3.utils.soliditySha3('OracleBTCEUR'),
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
        web3.utils.soliditySha3('OracleLINKEUR'),
      ],
      log: !argv.ci,
    });
    const oracle2 = (await deployments.get('Oracle_LINK_EUR')).address;
    console.log(`Successfully deployed Oracle ETH/EUR at the address ${oracle2}`);
    console.log('');
    console.log('Now deploying the Oracle ETH/EUR');
    await deploy('Oracle_ETH_EUR', {
      contract: 'OracleChainlinkMulti',
      from: deployer.address,
      args: [
        [json.Chainlink['ETH/USD'], json.Chainlink['EUR/USD']],
        [1, 0],
        parseEther('1'),
        3600 * 48,
        treasury,
        web3.utils.soliditySha3('OracleETHEUR'),
      ],
      log: !argv.ci,
    });
    const oracle3 = (await deployments.get('Oracle_ETH_EUR')).address;
    console.log(`Successfully deployed Oracle ETH/EUR at the address ${oracle3}`);
    console.log('');
  }
};

func.tags = ['oracle'];
func.dependencies = ['treasury'];
export default func;
