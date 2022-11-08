import { ChainId, CONTRACTS_ADDRESSES } from '@angleprotocol/sdk';
import { DeployFunction } from 'hardhat-deploy/types';

import { LayerZeroBridgeERC20__factory } from '../../../typechain';
import LZ_ENDPOINTS from '../../constants/layerzeroEndpoints.json';
import { deployImplem, deployProxy } from '../../helpers';

// To be deployed on Ethereum L1 for people to bridge from Ethereum to other chains using LayerZero
const func: DeployFunction = async ({ ethers, network }) => {
  if (network.config.chainId !== 1 && network.name !== 'localhost' && network.name !== 'hardhat')
    throw Error(`Bridge is built for L1, and you're on ${network.name}`);

  const token = 'ANGLE';
  const angle = CONTRACTS_ADDRESSES[ChainId.MAINNET].ANGLE!;
  const proxyAdmin = CONTRACTS_ADDRESSES[ChainId.MAINNET].ProxyAdmin!;
  const coreBorrow = CONTRACTS_ADDRESSES[ChainId.MAINNET].CoreBorrow!;

  const endpointAddr = (LZ_ENDPOINTS as { [name: string]: string })[network.name];
  console.log(`[${network.name}] LayerZero Endpoint address: ${endpointAddr}`);
  const layerZeroBridgeImplem = await deployImplem('LayerZeroBridgeERC20');

  console.log(proxyAdmin);
  await deployProxy(
    `LayerZeroBridgeERC20_${token}`,
    layerZeroBridgeImplem,
    proxyAdmin,
    LayerZeroBridgeERC20__factory.createInterface().encodeFunctionData('initialize', [
      `LayerZero Bridge ${token}`,
      endpointAddr,
      coreBorrow,
      angle,
    ]),
  );
};

func.tags = ['LayerZeroBridgeERC20'];
export default func;
