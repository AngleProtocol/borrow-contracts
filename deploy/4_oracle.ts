import { ChainId } from '@angleprotocol/sdk';
import { DeployFunction } from 'hardhat-deploy/types';
import yargs from 'yargs';

const argv = yargs.env('').boolean('ci').parseSync();

const func: DeployFunction = async ({ deployments, ethers, network }) => {
  const { deploy } = deployments;
  const { deployer } = await ethers.getNamedSigners();
  const stableName = 'GOLD';
  const treasury = (await deployments.get(`Treasury_${stableName}`)).address;

  let chainName: string;
  if (!network.live || network.config.chainId == 1) {
    chainName = '';
  } else {
    chainName = network.name.charAt(0).toUpperCase() + network.name.substring(1);
  }

  console.log('Now deploying the Oracle ETH/XAU');
  await deploy('Oracle_ETH_XAU', {
    contract: `OracleETHXAUChainlink${chainName}`,
    from: deployer.address,
    args: [3600 * 30, treasury],
    log: !argv.ci,
  });
  const oracle = (await deployments.get('Oracle_ETH_XAU')).address;
  console.log(`Successfully deployed Oracle ETH/XAU at the address ${oracle}`);
  console.log('');

  console.log('Now deploying the Oracle WSTETH/XAU');
  await deploy('Oracle_WSTETH_XAU', {
    contract: `OracleWSTETHXAUChainlink${chainName}`,
    from: deployer.address,
    args: [3600 * 30, treasury],
    log: !argv.ci,
  });
  const oracle2 = (await deployments.get('Oracle_WSTETH_XAU')).address;
  console.log(`Successfully deployed Oracle WSTETH/XAU at the address ${oracle2}`);
  console.log('');

  console.log('Now deploying the Oracle USDC/XAU');
  await deploy('Oracle_USDC_XAU', {
    contract: `OracleUSDCXAUChainlink${chainName}`,
    from: deployer.address,
    args: [3600 * 30, treasury],
    log: !argv.ci,
  });
  const oracle3 = (await deployments.get('Oracle_USDC_XAU')).address;
  console.log(`Successfully deployed Oracle USDC/XAU at the address ${oracle3}`);
  console.log('');
};

func.tags = ['oracle'];
func.dependencies = ['treasury'];
export default func;
