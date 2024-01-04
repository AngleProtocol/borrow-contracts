import { ChainId, registry } from '@angleprotocol/sdk/dist';
import { DeployFunction } from 'hardhat-deploy/types';

import { LayerZeroBridge__factory } from '../../typechain';
import { forkedChain, forkedChainName, stableName } from '../constants/constants';
import LZ_ENDPOINTS from '../constants/layerzeroEndpoints.json';
import { deployImplem, deployProxy } from '../helpers';

const func: DeployFunction = async ({ ethers, network, deployments }) => {
  if ((!network.live && (forkedChain as ChainId) == ChainId.MAINNET) || network.config.chainId == 1) {
    const treasury = await ethers.getContract(`Treasury_${stableName}`);
    const proxyAdminAddress = registry(ChainId.MAINNET)?.ProxyAdmin!;
    console.log(treasury.address, proxyAdminAddress);

    const endpointAddr = (LZ_ENDPOINTS as { [name: string]: string }).mainnet;
    console.log('Now deploying the LayerZero bridge contract');
    console.log(`[${network.name}] LayerZero Endpoint address: ${endpointAddr}`);
    let layerZeroBridgeImplem;
    try {
      layerZeroBridgeImplem = (await deployments.get('LayerZeroBridge')).address;
    } catch {
      // Typically if we're in mainnet fork
      layerZeroBridgeImplem = await deployImplem('LayerZeroBridge');
    }

    await deployProxy(
      `LayerZeroBridge_${stableName}`,
      layerZeroBridgeImplem,
      proxyAdminAddress,
      LayerZeroBridge__factory.createInterface().encodeFunctionData('initialize', [
        `LayerZero Bridge ag${stableName}`,
        endpointAddr,
        treasury.address,
      ]),
    );
  } else {
    console.log(`Not deploying any LayerZeroBridge contract on ${forkedChainName}`);
    console.log('');
  }
};

func.tags = ['lzBridgeNewStable'];
func.dependencies = ['vaultNewStable'];
export default func;
