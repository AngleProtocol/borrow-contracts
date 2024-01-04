import { Contract } from 'ethers';
import { DeployFunction } from 'hardhat-deploy/types';

import { LayerZeroBridge, LayerZeroBridge__factory } from '../../typechain';
import { OFTs } from '../constants';
import LZ_CHAINIDS from '../constants/layerzeroChainIds.json';

// For more details on trustedRemote, check: https://layerzero.gitbook.io/docs/evm-guides/master/set-trusted-remotes
// LayerZero chains: https://layerzero.gitbook.io/docs/technical-reference/mainnet/supported-chain-ids
const func: DeployFunction = async ({ ethers, network }) => {
  const { deployer } = await ethers.getNamedSigners();
  const stable = 'USD';

  const local = OFTs[stable]?.[network.name] as string;
  const contractAngleOFT = new Contract(local, LayerZeroBridge__factory.abi, deployer) as LayerZeroBridge;

  console.log(`Setting the trusted remote addresses on ${network.name}`);
  console.log('--------------------------------------------');
  for (const chain of Object.keys(OFTs[stable])) {
    if (chain !== network.name) {
      console.log(chain);
      const trustedRemote = ethers.utils.solidityPack(['address', 'address'], [OFTs[stable][chain], local]);
      console.log(`Trusted remote ${trustedRemote}`);
      console.log(local);
      console.log(
        contractAngleOFT.interface.encodeFunctionData('setTrustedRemote', [(LZ_CHAINIDS as any)[chain], trustedRemote]),
      );
      console.log((LZ_CHAINIDS as any)[chain], trustedRemote);
      console.log('');

      console.log('Now setting the trusted remote');
      // Check admin rights here
      await (
        await contractAngleOFT.connect(deployer).setTrustedRemote((LZ_CHAINIDS as any)[chain], trustedRemote)
      ).wait();
      console.log('Success');
    }
  }
  console.log('--------------------------------------------');
  console.log('');
};

func.tags = ['lzSetupNewStable'];
export default func;
