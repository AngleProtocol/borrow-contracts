import { Contract } from 'ethers';
import { DeployFunction } from 'hardhat-deploy/types';

import { LayerZeroBridge, LayerZeroBridge__factory } from '../../typechain';
import LZ_CHAINIDS from '../constants/layerzeroChainIds.json';

const func: DeployFunction = async ({ ethers, network }) => {
  // Using an EOA as proxyAdmin as it's a mock deployment
  const { deployer } = await ethers.getNamedSigners();

  const OFTs: { [string: string]: string } = {
    polygon: '0x0c1EBBb61374dA1a8C57cB6681bF27178360d36F',
    optimism: '0x840b25c87B626a259CA5AC32124fA752F0230a72',
    arbitrum: '0x16cd38b1B54E7abf307Cb2697E2D9321e843d5AA',
    mainnet: '0x4Fa745FCCC04555F2AFA8874cd23961636CdF982',
  };

  const local = OFTs[network.name];
  const contractAngleOFT = new Contract(local, LayerZeroBridge__factory.abi, deployer) as LayerZeroBridge;

  for (const chain of Object.keys(OFTs)) {
    if (chain !== network.name) {
      console.log(
        contractAngleOFT.interface.encodeFunctionData('setTrustedRemote', [(LZ_CHAINIDS as any)[chain], OFTs[chain]]),
      );
    }
  }
};

func.tags = ['LayerZeroSources'];
export default func;
