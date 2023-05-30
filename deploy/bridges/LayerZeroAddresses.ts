import { ChainId, registry } from '@angleprotocol/sdk';
import { Contract } from 'ethers';
import { DeployFunction } from 'hardhat-deploy/types';

import { LayerZeroBridge, LayerZeroBridge__factory } from '../../typechain';
import LZ_CHAINIDS from '../constants/layerzeroChainIds.json';

const func: DeployFunction = async ({ ethers, network }) => {
  const { deployer } = await ethers.getNamedSigners();

  const chains = [
    ChainId.POLYGON,
    ChainId.ARBITRUM,
    ChainId.CELO,
    ChainId.BSC,
    ChainId.AVALANCHE,
    ChainId.OPTIMISM,
    ChainId.GNOSIS,
  ];

  for (const chain of chains) {
    console.log(chain);
    console.log(registry(chain)?.ProxyAdmin);
    console.log(registry(chain)?.agEUR?.bridges?.LayerZero);
  }
};

func.tags = ['LayerZeroAddresses'];
export default func;
