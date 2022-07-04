import { ChainId, CONTRACTS_ADDRESSES } from '@angleprotocol/sdk';
import { DeployFunction } from 'hardhat-deploy/types';
import yargs from 'yargs';
import { expect } from '../test/utils/chai-setup';
import { deployImplem, deployProxy } from './helpers';

import { AgTokenSideChainMultiBridge, AgTokenSideChainMultiBridge__factory, Treasury__factory } from '../typechain';

const argv = yargs.env('').boolean('ci').parseSync();

const func: DeployFunction = async ({ deployments, ethers, network }) => {
  const { deploy } = deployments;
  const { deployer } = await ethers.getNamedSigners();
  let proxyAdmin: string;
  let agTokenAddress: string;
  const stableName = 'EUR';
  const agTokenName = `ag${stableName}`;

  if (!network.live || network.config.chainId == 1) {
    // If we're in mainnet fork, we're using the `ProxyAdmin` address from mainnet
    proxyAdmin = CONTRACTS_ADDRESSES[ChainId.MAINNET].ProxyAdmin!;
    agTokenAddress = CONTRACTS_ADDRESSES[ChainId.MAINNET].agEUR?.AgToken!;
  } else {
    // Otherwise, we're using the proxy admin address from the desired network and the newly deployed agToken
    proxyAdmin = (await ethers.getContract('ProxyAdmin')).address;
    if (network.config.chainId !== ChainId.POLYGON) {
      agTokenAddress = (await deployments.get(`AgToken_${stableName}`)).address;
    } else {
      agTokenAddress = CONTRACTS_ADDRESSES[ChainId.POLYGON].agEUR?.AgToken!;
    }
  }

  console.log('Now deploying Treasury');
  const treasuryImplementation = await deployImplem('Treasury');

  const treasuryInterface = Treasury__factory.createInterface();
  const coreBorrow = await deployments.get('CoreBorrow');
  const dataTreasury = new ethers.Contract(
    treasuryImplementation,
    treasuryInterface,
  ).interface.encodeFunctionData('initialize', [coreBorrow.address, agTokenAddress]);

  // const treasury = await deployProxy('Treasury', treasuryImplementation, proxyAdmin, dataTreasury);
  const treasury = (await deployments.get('Treasury')).address;

  console.log('');
  if (network.config.chainId != 1 && network.config.chainId != ChainId.POLYGON) {
    console.log('Initializing the agToken contract now that we have the treasury address');
    const agToken = new ethers.Contract(
      agTokenAddress,
      AgTokenSideChainMultiBridge__factory.createInterface(),
      deployer,
    ) as AgTokenSideChainMultiBridge;
    await (await agToken.connect(deployer).initialize(agTokenName, agTokenName, treasury)).wait();
    console.log('Success: agToken successfully initialized');
  }
};

func.tags = ['treasury'];
func.dependencies = ['agTokenImplementation'];
export default func;
