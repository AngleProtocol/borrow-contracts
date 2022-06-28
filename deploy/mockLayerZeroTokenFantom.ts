import { ChainId, CONTRACTS_ADDRESSES } from '@angleprotocol/sdk';
import { BigNumber, Contract } from 'ethers';
import { parseEther } from 'ethers/lib/utils';
import { DeployFunction } from 'hardhat-deploy/types';
import yargs from 'yargs';

import { ZERO_ADDRESS } from '../test/utils/helpers';
import { AgTokenSideChainMultiBridge, AgTokenSideChainMultiBridge__factory } from '../typechain';
import LZ_ENDPOINTS from './constants/layerzeroEndpoints.json';

const argv = yargs.env('').boolean('ci').parseSync();

const func: DeployFunction = async ({ deployments, ethers, network }) => {
  const { deploy } = deployments;
  const { deployer, proxyAdmin } = await ethers.getNamedSigners();
  // let proxyAdmin: string;

  // if (!network.live) {
  //   // If we're in mainnet fork, we're using the `ProxyAdmin` address from mainnet
  //   proxyAdmin = CONTRACTS_ADDRESSES[ChainId.MAINNET].ProxyAdmin!;
  // } else {
  //   // Otherwise, we're using the proxy admin address from the desired network
  //   proxyAdmin = (await ethers.getContract('ProxyAdmin')).address;
  // }

  console.log('Now deploying AgTokenSideChainMultiBridge');
  let canonicalAgTokenImplementation;
  try {
    canonicalAgTokenImplementation = (await ethers.getContract('Mock_AgTokenSideChainMultiBridge_Implementation'))
      .address;
    console.log(
      `AgTokenSideChainMultiBridge_Implementation implementation has already been deployed at ${canonicalAgTokenImplementation}`,
    );
  } catch {
    await deploy('Mock_AgTokenSideChainMultiBridge_Implementation', {
      contract: 'AgTokenSideChainMultiBridge',
      from: deployer.address,
      log: !argv.ci,
    });
    canonicalAgTokenImplementation = (await ethers.getContract('Mock_AgTokenSideChainMultiBridge_Implementation'))
      .address;
    console.log(
      `Successfully deployed the implementation for AgTokenSideChainMultiBridge at ${canonicalAgTokenImplementation}`,
    );
  }

  console.log('Now deploying the Proxy');
  await deploy('Mock_AgTokenSideChainMultiBridge', {
    contract: 'TransparentUpgradeableProxy',
    from: deployer.address,
    args: [canonicalAgTokenImplementation, proxyAdmin.address, '0x'],
    log: !argv.ci,
  });
  const agToken = (await ethers.getContract('Mock_AgTokenSideChainMultiBridge')).address;
  console.log(`Successfully deployed the implementation for AgTokenSideChainMultiBridge at ${agToken}`);

  console.log('Now deploying MockTreasury');
  await deploy('MockTreasury', {
    contract: 'MockTreasury',
    from: deployer.address,
    log: !argv.ci,
    args: [agToken, deployer.address, deployer.address, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS],
  });
  const treasury = (await ethers.getContract('MockTreasury')).address;
  console.log(`Successfully deployed the implementation for MockTreasury at ${treasury}`);

  // console.log('Initializing the proxy');
  const contract = new Contract(
    agToken,
    AgTokenSideChainMultiBridge__factory.abi,
    deployer,
  ) as AgTokenSideChainMultiBridge;
  // await (await contract.initialize('AgEUR_TEST', 'AgEUR_TEST', treasury)).wait();

  console.log('Now deploying AngleOFT');
  const endpointAddr = (LZ_ENDPOINTS as { [name: string]: string })[network.name];
  console.log(`[${network.name}] LayerZero Endpoint address: ${endpointAddr}`);
  await deploy('Mock_AngleOFT', {
    contract: 'AngleETHOFT',
    from: deployer.address,
    log: !argv.ci,
    args: ['AgEUR_LayerZero_TEST', 'AgEUR_LayerZero_TEST', endpointAddr, treasury],
  });
  const angleOFT = (await ethers.getContract('Mock_AngleOFT')).address;
  console.log(`Successfully deployed AngleOFT at ${angleOFT}`);

  console.log('Adding LayerZero');
  await (
    await contract.addBridgeToken(angleOFT, parseEther('1000000'), parseEther('100000'), BigNumber.from(1e7), false)
  ).wait();
};

func.tags = ['mockLayerZeroFantom'];
export default func;
