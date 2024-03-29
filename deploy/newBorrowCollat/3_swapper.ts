import { AngleRegistry__factory, ChainId, registry } from '@angleprotocol/sdk';
import { DeployFunction } from 'hardhat-deploy/types';
import yargs from 'yargs';

const argv = yargs.env('').boolean('ci').parseSync();

const func: DeployFunction = async ({ deployments, ethers, network }) => {
  const { deployer } = await ethers.getNamedSigners();
  const { deploy } = deployments;
  const json = await import('./networks/' + network.name + '.json');

  let core;
  let angleRouter;

  if (!network.live) {
    core = registry(ChainId.MAINNET)?.CoreBorrow;
    angleRouter = registry(ChainId.MAINNET)?.AngleRouterV2;
  } else {
    core = registry(network.config.chainId as ChainId)?.CoreBorrow;
    angleRouter = registry(network.config.chainId as ChainId)?.AngleRouterV2;
  }

  console.log('Now deploying the swapper contract');

  const oneInchRouter = json.oneInchRouter;
  console.log('Checking contract addresses');
  console.log(`${core} ${json.uniswapV3Router} ${oneInchRouter} ${angleRouter}`);

  await deploy(`Swapper`, {
    contract: 'Swapper',
    from: deployer.address,
    args: [core, json.uniswapV3Router, oneInchRouter, angleRouter],
    log: !argv.ci,
  });
  console.log('Success');
  const swapperAddress = (await deployments.get('Swapper')).address;
  console.log(`${swapperAddress}`);
};

func.tags = ['swapper'];
// func.dependencies = ['vaultManagerProxy'];
export default func;
