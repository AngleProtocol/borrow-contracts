import { DeployFunction } from 'hardhat-deploy/types';
import yargs from 'yargs';

import { OracleSTEURETHChainlinkArbitrum, OracleSTEURETHChainlinkArbitrum__factory } from '../../typechain';

const argv = yargs.env('').boolean('ci').parseSync();

const func: DeployFunction = async ({ deployments, ethers, network }) => {
  const { deploy } = deployments;
  const { deployer } = await ethers.getNamedSigners();

  // const treasury = (await deployments.get(`Treasury`)).address;
  const treasury = '0x37963F10245e7c3a10c0E9d43a6E617B4Bc8440A';
  console.log('Now deploying the Oracle wstETH/USD');
  console.log(`Treasury: ${treasury}`);
  await deploy('Oracle_STEUR_ETH', {
    contract: `OracleSTEURETHChainlinkArbitrum`,
    from: deployer.address,
    args: [3600 * 36, treasury],
    log: !argv.ci,
  });
  const oracle = (await deployments.get('Oracle_STEUR_ETH')).address;
  console.log(`Successfully deployed Oracle stEUR/ETH at the address ${oracle}`);

  const oracleContract = new ethers.Contract(
    oracle,
    OracleSTEURETHChainlinkArbitrum__factory.createInterface(),
    deployer,
  ) as OracleSTEURETHChainlinkArbitrum;

  const oracleValue = await oracleContract.read();
  console.log('Oracle value', oracleValue.toString());
  console.log('');
};

func.tags = ['newOracle'];
export default func;
