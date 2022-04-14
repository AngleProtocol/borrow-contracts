import { ChainId, CONTRACTS_ADDRESSES } from '@angleprotocol/sdk';
import { DeployFunction } from 'hardhat-deploy/types';
import yargs from 'yargs';

const argv = yargs.env('').boolean('ci').parseSync();

const func: DeployFunction = async ({ deployments, ethers, network }) => {
  const { deployer } = await ethers.getNamedSigners();
  const { deploy } = deployments;
  const json = await import('./networks/' + network.name + '.json');

  const core = (await deployments.get('CoreBorrow')).address;
  const routerAddress = CONTRACTS_ADDRESSES[ChainId.MAINNET].AngleRouter!;

  await deploy(`Swapper`, {
    contract: 'Swapper',
    from: deployer.address,
    args: [core, json.tokens.wstETH, json.uniswapV3Router, json.oneInchRouter, routerAddress],
    log: !argv.ci,
  });
};

func.tags = ['swapper'];
func.dependencies = ['router'];
export default func;
