import { ChainId, registry } from '@angleprotocol/sdk/dist';
import { DeployFunction } from 'hardhat-deploy/types';

import { LayerZeroBridge__factory } from '../../typechain';
import LZ_ENDPOINTS from '../constants/layerzeroEndpoints.json';
import { deployImplem, deployProxy } from '../helpers';

const stable = 'USD';

const func: DeployFunction = async ({ ethers, network, deployments }) => {
  if (network.config.chainId !== 1 && network.name !== 'localhost') {
    console.log(`Bridge is built for L1, and you're on ${network.name}`);
  } else {
    const treasury = await ethers.getContract(`Treasury_${stable}`);
    const proxyAdminAddress = registry(ChainId.MAINNET)?.ProxyAdmin!;
    console.log(treasury, proxyAdminAddress);

    const endpointAddr = (LZ_ENDPOINTS as { [name: string]: string })[network.name];
    console.log(`[${network.name}] LayerZero Endpoint address: ${endpointAddr}`);
    let layerZeroBridgeImplem;
    try {
      layerZeroBridgeImplem = (await deployments.get('LayerZeroBridge')).address;
    } catch {
      // Typically if we're in mainnet fork
      layerZeroBridgeImplem = await deployImplem('LayerZeroBridge');
    }

    await deployProxy(
      `LayerZeroBridge_${stable}`,
      layerZeroBridgeImplem,
      proxyAdminAddress,
      LayerZeroBridge__factory.createInterface().encodeFunctionData('initialize', [
        `LayerZero Bridge ag${stable}`,
        endpointAddr,
        treasury.address,
      ]),
    );
  }
};

func.tags = ['lzBridgeNewStable'];
func.dependencies = ['vaultNewStable'];
export default func;
