import { ChainId, CONTRACTS_ADDRESSES } from '@angleprotocol/sdk';
import { DeployFunction } from 'hardhat-deploy/types';
import yargs from 'yargs';
import { expect } from '../test/utils/chai-setup';

const argv = yargs.env('').boolean('ci').parseSync();

const func: DeployFunction = async ({ deployments, ethers, network }) => {
  const { deployer } = await ethers.getNamedSigners();
  const { deploy } = deployments;
  const json = await import('./networks/' + network.name + '.json');

  const core = (await deployments.get('CoreBorrow')).address;
  const routerAddress = CONTRACTS_ADDRESSES[ChainId.MAINNET].AngleRouter!;

  expect(routerAddress).to.be.equal('0xBB755240596530be0c1DE5DFD77ec6398471561d');
  expect(json.tokens.wstETH).to.be.equal('0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0');
  expect(json.uniswapV3Router).to.be.equal('0xE592427A0AEce92De3Edee1F18E0157C05861564');
  expect(json.oneInchRouter).to.be.equal('0x1111111254fb6c44bAC0beD2854e76F90643097d');

  console.log('Now deploying the swapper contract');

  await deploy(`Swapper`, {
    contract: 'Swapper',
    from: deployer.address,
    args: [core, json.tokens.wstETH, json.uniswapV3Router, json.oneInchRouter, routerAddress],
    log: !argv.ci,
  });
  console.log('Success');

  // The only contract leftover to be deployed is the router contract which should be deployed from another repo
};

func.tags = ['swapper'];
func.dependencies = ['vaultManagerProxy'];
export default func;
