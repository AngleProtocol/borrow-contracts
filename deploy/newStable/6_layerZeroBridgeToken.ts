import { ChainId, registry } from '@angleprotocol/sdk';
import { parseEther } from 'ethers/lib/utils';
import { DeployFunction } from 'hardhat-deploy/types';
import yargs from 'yargs';

import {
  AgTokenSideChainMultiBridge,
  AgTokenSideChainMultiBridge__factory,
  LayerZeroBridgeToken,
  LayerZeroBridgeToken__factory,
} from '../../typechain';
import { forkedChain, minedAddress, stableName } from '../constants/constants';
import LZ_ENDPOINTS from '../constants/layerzeroEndpoints.json';
import { deployProxy } from '../helpers';

const argv = yargs.env('').boolean('ci').parseSync();
const func: DeployFunction = async ({ ethers, network, deployments }) => {
  const { deploy } = deployments;
  const { deployer } = await ethers.getNamedSigners();
  const isDeployerAdmin = true;
  if ((!network.live && (forkedChain as ChainId) == ChainId.MAINNET) || network.config.chainId == 1) {
    console.log('');
    console.log('Not deploying any bridge token on Ethereum');
    console.log('');
  } else {
    const treasury = await ethers.getContract(`Treasury_${stableName}`);
    let proxyAdmin;
    if (!network.live) {
      proxyAdmin = registry(forkedChain)?.ProxyAdmin!;
    } else {
      proxyAdmin = registry(network.config.chainId as ChainId)?.ProxyAdmin!;
    }

    console.log(treasury.address, proxyAdmin);

    const endpointAddr = (LZ_ENDPOINTS as { [name: string]: string })[network.name];
    console.log(`[${network.name}] LayerZero Endpoint address: ${endpointAddr}`);
    const deploymentName = 'LayerZeroBridgeToken_V1_0_Implementation';

    let implementationAddress;
    try {
      implementationAddress = (await ethers.getContract(deploymentName)).address;
    } catch {
      await deploy(deploymentName, {
        contract: 'LayerZeroBridgeToken',
        from: deployer.address,
        log: !argv.ci,
      });
      implementationAddress = (await ethers.getContract(deploymentName)).address;
    }

    const lzAddress = await deployProxy(
      `LayerZeroBridge_${stableName}`,
      implementationAddress,
      proxyAdmin,
      LayerZeroBridgeToken__factory.createInterface().encodeFunctionData('initialize', [
        `LayerZero Bridge ag${stableName}`,
        `LZ-ag${stableName}`,
        endpointAddr,
        treasury.address,
        parseEther('0'),
      ]),
    );

    if (isDeployerAdmin) {
      const lzTokenContract = new ethers.Contract(
        lzAddress,
        LayerZeroBridgeToken__factory.createInterface(),
        deployer,
      ) as LayerZeroBridgeToken;
      const agTokenContract = new ethers.Contract(
        minedAddress,
        AgTokenSideChainMultiBridge__factory.createInterface(),
        deployer,
      ) as AgTokenSideChainMultiBridge;
      console.log('Setting the useCustomAdapterParams');
      await (await lzTokenContract.setUseCustomAdapterParams(1)).wait();
      console.log('Success');
      console.log('Adding bridge token');
      await (
        await agTokenContract.addBridgeToken(lzAddress, parseEther('1000000'), parseEther('50000'), 0, false)
      ).wait();
      /*
      console.log('Success');
      console.log('Setting chain total hourly limit');
      await (await agTokenContract.setChainTotalHourlyLimit(parseEther('5000'))).wait();
      console.log('Success');
      console.log('');
      */
    }
    // The last thing to be done is to set the trusted remote once everything has been deployed
  }
};

func.tags = ['lzBridgeTokenNewStable'];
// func.dependencies = ['lzBridgeNewStable'];
export default func;
