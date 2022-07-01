import { BigNumber, Contract } from 'ethers';
import { parseEther } from 'ethers/lib/utils';
import { deployments } from 'hardhat';
import { DeployFunction } from 'hardhat-deploy/types';

import LZ_CHAINIDS from '../../deploy/constants/layerzeroChainIds.json';
import { ZERO_ADDRESS } from '../../test/utils/helpers';
import {
  AgTokenSideChainMultiBridge,
  AgTokenSideChainMultiBridge__factory,
  LayerZeroBridge,
  LayerZeroBridge__factory,
  MockTreasury,
  MockTreasury__factory,
} from '../../typechain';
import LZ_ENDPOINTS from '../constants/layerzeroEndpoints.json';
import { deploy, deployImplem, deployProxy } from '../helpers';

const func: DeployFunction = async ({ ethers, network }) => {
  // Using an EOA as proxyAdmin as it's a mock deployment
  const { deployer, proxyAdmin } = await ethers.getNamedSigners();

  const OFTs: { [string: string]: string } = {
    fantom: '0x5ae1cAa23E540c243f5a45d283feD041b2FC4177',
    polygon: '0x21Ee82653b8caFa1EAF6e54080d93150F32AD176',
  };

  const local = OFTs[network.name];
  const contractAngleOFT = new Contract(local, LayerZeroBridge__factory.abi, deployer) as LayerZeroBridge;

  for (const chain of Object.keys(OFTs)) {
    if (chain !== local) {
      const tx = await contractAngleOFT.setTrustedRemote((LZ_CHAINIDS as any)[chain], OFTs[chain]);
      await tx.wait();
    }
  }
};

func.tags = ['mockLayerZeroSources'];
export default func;
