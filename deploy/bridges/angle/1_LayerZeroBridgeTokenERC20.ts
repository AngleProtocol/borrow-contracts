import { ChainId, CONTRACTS_ADDRESSES } from '@angleprotocol/sdk';
import { parseEther } from 'ethers/lib/utils';
import { DeployFunction } from 'hardhat-deploy/types';

import {
  AngleSideChainMultiBridge,
  AngleSideChainMultiBridge__factory,
  LayerZeroBridgeTokenERC20__factory,
} from '../../../typechain';
import LZ_ENDPOINTS from '../../constants/layerzeroEndpoints.json';
import { deployImplem, deployProxy } from '../../helpers';

const token = 'ANGLE';

const func: DeployFunction = async ({ ethers, network }) => {
  const { deployer } = await ethers.getNamedSigners();

  let proxyAdmin: string;
  let coreBorrow: string;

  if (!network.live) {
    // If we're in mainnet fork, we're using the `ProxyAdmin` address from mainnet
    proxyAdmin = CONTRACTS_ADDRESSES[ChainId.MAINNET].ProxyAdmin!;
    coreBorrow = CONTRACTS_ADDRESSES[ChainId.MAINNET].CoreBorrow!;
  } else {
    // Otherwise, we're using the proxy admin address from the desired network
    proxyAdmin = (await ethers.getContract('ProxyAdmin')).address;
    coreBorrow = (await ethers.getContract('CoreBorrow')).address;
  }

  const angle = await ethers.getContract(`ANGLE_${network.name}`);

  const endpointAddr = (LZ_ENDPOINTS as { [name: string]: string })[network.name];
  console.log(`[${network.name}] LayerZero Endpoint address: ${endpointAddr}`);
  const layerZeroBridgeImplem = await deployImplem('LayerZeroBridgeTokenERC20');

  console.log('Now deploying the proxy ');

  const lzAddress = await deployProxy(
    `LayerZeroBridgeERC20_${token}`,
    layerZeroBridgeImplem,
    proxyAdmin,
    LayerZeroBridgeTokenERC20__factory.createInterface().encodeFunctionData('initialize', [
      `LayerZero Bridge ${token}`,
      `LZ-${token}`,
      endpointAddr,
      coreBorrow,
      angle.address,
    ]),
  );

  console.log('Success, contract deployed, we can now initialize');
  const angleContract = new ethers.Contract(
    angle.address,
    AngleSideChainMultiBridge__factory.createInterface(),
    deployer,
  ) as AngleSideChainMultiBridge;
  // We can now initialize the ANGLE contract

  await angleContract.initialize(
    `ANGLE_${network.name}`,
    'ANGLE',
    coreBorrow,
    lzAddress,
    // Total limit
    parseEther('3000000'),
    // Hourly limit (set so that we can do our bridge transactions easily when creating programs)
    parseEther('300000'),
    0,
    false,
    // Chain total hourly limit
    parseEther('500000'),
  );
  console.log('Initialization successful');
};

func.tags = ['LayerZeroBridgeTokenERC20'];
func.dependencies = ['angleSideChain'];
export default func;
