import { ChainId, registry } from '@angleprotocol/sdk';
import { DeployFunction } from 'hardhat-deploy/types';
import yargs from 'yargs';

import { AgTokenSideChainMultiBridge, AgTokenSideChainMultiBridge__factory, Treasury__factory } from '../../typechain';
import { forkedChain, minedAddress, stableName } from '../constants/constants';
import { deployProxy } from '../helpers';

const argv = yargs.env('').boolean('ci').parseSync();

const func: DeployFunction = async ({ deployments, ethers, network }) => {
  const { deploy } = deployments;
  const { deployer } = await ethers.getNamedSigners();
  let proxyAdmin: string;
  let coreBorrow: string;

  const agTokenName = `Angle ${stableName}`;
  const agTokenSymbol = `ag${stableName}`;

  if (!network.live) {
    proxyAdmin = registry(forkedChain)?.ProxyAdmin!;
  } else {
    proxyAdmin = registry(network.config.chainId as ChainId)?.ProxyAdmin!;
  }
  coreBorrow = (await deployments.get('CoreBorrowTest')).address;
  let treasuryImplementation: string;
  try {
    treasuryImplementation = (await deployments.get('Treasury_Implementation')).address;
  } catch {
    // Typically if we're in mainnet fork
    console.log('Now deploying Treasury implementation');
    await deploy('Treasury_Implementation', {
      contract: 'Treasury',
      from: deployer.address,
      args: [],
      log: !argv.ci,
    });
    treasuryImplementation = (await deployments.get('Treasury_Implementation')).address;
  }

  const treasuryInterface = Treasury__factory.createInterface();
  const dataTreasury = new ethers.Contract(treasuryImplementation, treasuryInterface).interface.encodeFunctionData(
    'initialize',
    [coreBorrow, minedAddress],
  );

  const treasury = await deployProxy(`Treasury_${stableName}`, treasuryImplementation, proxyAdmin, dataTreasury);

  console.log('');

  console.log('Initializing the agToken contract now that we have the treasury address');
  const agToken = new ethers.Contract(
    minedAddress,
    AgTokenSideChainMultiBridge__factory.createInterface(),
    deployer,
  ) as AgTokenSideChainMultiBridge;
  await (await agToken.connect(deployer).initialize(agTokenName, agTokenSymbol, treasury)).wait();
  console.log('Success: agToken successfully initialized');
  console.log('');
};

func.tags = ['treasuryNewStable'];
func.dependencies = ['agTokenNewStable'];
export default func;
