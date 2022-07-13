import { DeployFunction } from 'hardhat-deploy/types';

import { LayerZeroBridge__factory } from '../../typechain';
import LZ_ENDPOINTS from '../constants/layerzeroEndpoints.json';
import { deployImplem, deployProxy } from '../helpers';

const stable = 'EUR';

const func: DeployFunction = async ({ ethers, network }) => {
  if (network.config.chainId !== 1 && network.name !== 'localhost')
    throw Error(`Bridge is built for L1, and you're on ${network.name}`);

  const treasury = await ethers.getContract('Treasury');
  const proxyAdmin = await ethers.getContract('ProxyAdmin');

  const endpointAddr = (LZ_ENDPOINTS as { [name: string]: string })[network.name];
  console.log(`[${network.name}] LayerZero Endpoint address: ${endpointAddr}`);
  const layerZeroBridgeImplem = await deployImplem('LayerZeroBridge');

  console.log(proxyAdmin.address);
  await deployProxy(
    `LayerZeroBridge_${stable}`,
    layerZeroBridgeImplem,
    proxyAdmin.address,
    LayerZeroBridge__factory.createInterface().encodeFunctionData('initialize', [
      `LayerZero Bridge ag${stable}`,
      endpointAddr,
      treasury.address,
    ]),
  );
};

func.tags = ['LayerZeroBridge'];
export default func;
