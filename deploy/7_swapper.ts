import { ChainId, registry } from '@angleprotocol/sdk';
import { DeployFunction } from 'hardhat-deploy/types';
import yargs from 'yargs';

const argv = yargs.env('').boolean('ci').parseSync();

const func: DeployFunction = async ({ deployments, ethers, network }) => {
  const { deployer } = await ethers.getNamedSigners();
  const { deploy } = deployments;
  const json = await import('./networks/' + network.name + '.json');

  const core = (await deployments.get('CoreBorrow')).address;

  console.log('Now deploying the swapper contract');
  // const angleRouter = registry(network.config.chainId as ChainId)?.AngleRouterV2;
  // const oneInchRouter = json.oneInchRouter;
  const oneInchRouter = '0x1111111254fb6c44bAC0beD2854e76F90643097d';
  const angleRouter = '0xf530b844fb797D2C6863D56a94777C3e411CEc86';
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
