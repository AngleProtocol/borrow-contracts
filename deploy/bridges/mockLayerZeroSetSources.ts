import { Contract } from 'ethers';
import { DeployFunction } from 'hardhat-deploy/types';

import LZ_CHAINIDS from '../../deploy/constants/layerzeroChainIds.json';
import { LayerZeroBridge, LayerZeroBridge__factory } from '../../typechain';

const func: DeployFunction = async ({ ethers, network }) => {
  // Using an EOA as proxyAdmin as it's a mock deployment
  const { deployer } = await ethers.getNamedSigners();

  const OFTs: { [string: string]: string } = {
    fantom: '0x5ae1cAa23E540c243f5a45d283feD041b2FC4177',
    polygon: '0x87C88923c7149baE28e6E5cE11b968183707657f',
  };

  const local = OFTs[network.name];
  const contractAngleOFT = new Contract(local, LayerZeroBridge__factory.abi, deployer) as LayerZeroBridge;

  for (const chain of Object.keys(OFTs)) {
    if (chain !== network.name) {
      const tx = await contractAngleOFT.setTrustedRemote((LZ_CHAINIDS as any)[chain], OFTs[chain]);
      await tx.wait();
    }
  }
};

func.tags = ['mockLayerZeroSources'];
export default func;
