import { Contract } from 'ethers';
import { DeployFunction } from 'hardhat-deploy/types';

import { LayerZeroBridge, LayerZeroBridge__factory } from '../../typechain';
import LZ_CHAINIDS from '../constants/layerzeroChainIds.json';

const func: DeployFunction = async ({ ethers, network }) => {
  const { deployer } = await ethers.getNamedSigners();

  const OFTs: { [string: string]: string } = {
    polygon: '0x0c1EBBb61374dA1a8C57cB6681bF27178360d36F',
    optimism: '0x840b25c87B626a259CA5AC32124fA752F0230a72',
    arbitrum: '0x16cd38b1B54E7abf307Cb2697E2D9321e843d5AA',
    mainnet: '0x4Fa745FCCC04555F2AFA8874cd23961636CdF982',
    avalanche: '0x14C00080F97B9069ae3B4Eb506ee8a633f8F5434',
    bsc: '0x1a7e4e63778B4f12a199C062f3eFdD288afCBce8',
  };

  const local = OFTs[network.name];
  const contractAngleOFT = new Contract(local, LayerZeroBridge__factory.abi, deployer) as LayerZeroBridge;

  for (const chain of Object.keys(OFTs)) {
    if (chain !== network.name) {
      console.log(chain);
      let trustedRemote = ethers.utils.solidityPack(['address', 'address'], [OFTs[chain], local]);
      console.log(`Trusted remote ${trustedRemote}`);
      console.log(
        contractAngleOFT.interface.encodeFunctionData('setTrustedRemote', [(LZ_CHAINIDS as any)[chain], trustedRemote]),
      );
      console.log('');
    }
  }
};

func.tags = ['LayerZeroSources'];
export default func;
