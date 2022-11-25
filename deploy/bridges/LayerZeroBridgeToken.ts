import { parseEther } from 'ethers/lib/utils';
import { DeployFunction } from 'hardhat-deploy/types';

import { LayerZeroBridgeToken__factory } from '../../typechain';
import LZ_ENDPOINTS from '../constants/layerzeroEndpoints.json';
import { deployImplem, deployProxy } from '../helpers';

const stable = 'EUR';

const func: DeployFunction = async ({ ethers, network }) => {
  const treasury = await ethers.getContract('Treasury');
  const proxyAdmin = await ethers.getContract('ProxyAdmin');

  const endpointAddr = (LZ_ENDPOINTS as { [name: string]: string })[network.name];
  console.log(`[${network.name}] LayerZero Endpoint address: ${endpointAddr}`);
  const layerZeroBridgeImplem = await deployImplem('LayerZeroBridgeToken');

  await deployProxy(
    `LayerZeroBridge_${stable}`,
    layerZeroBridgeImplem,
    proxyAdmin.address,
    LayerZeroBridgeToken__factory.createInterface().encodeFunctionData('initialize', [
      `LayerZero Bridge ag${stable}`,
      `LZ-ag${stable}`,
      endpointAddr,
      treasury.address,
      parseEther('100000'),
    ]),
  );

  /* The following things need to be done after this deployment:
  - setSources on the LayerZeroBridgeToken
  - addBridgeToken in the canonical agEUR -> limit should be higher than the limit which has already been minted in the contract
  - setChainTotalHourlyLimit in the canonical agEUR
  */
};

func.tags = ['LayerZeroBridgeToken'];
export default func;
