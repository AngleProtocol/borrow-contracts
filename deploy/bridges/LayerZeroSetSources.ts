import { Contract } from 'ethers';
import { DeployFunction } from 'hardhat-deploy/types';

import { LayerZeroBridge, LayerZeroBridge__factory } from '../../typechain';
import { OFTs } from '../constants/constants';
import LZ_CHAINIDS from '../constants/layerzeroChainIds.json';

// For more details on trustedRemote, check: https://layerzero.gitbook.io/docs/evm-guides/master/set-trusted-remotes
// LayerZero chains: https://layerzero.gitbook.io/docs/technical-reference/mainnet/supported-chain-ids
const func: DeployFunction = async ({ ethers, network }) => {
  const { deployer } = await ethers.getNamedSigners();
  const stableName = 'EUR';

  const local = OFTs[stableName][network.name];
  const contractAngleOFT = new Contract(local, LayerZeroBridge__factory.abi, deployer) as LayerZeroBridge;

  console.log('Getting payloads to execute on the new chain');
  console.log('--------------------------------------------');
  for (const chain of Object.keys(OFTs[stableName])) {
    if (chain !== network.name) {
      console.log(chain);
      const trustedRemote = ethers.utils.solidityPack(['address', 'address'], [OFTs[stableName][chain], local]);
      console.log(`Trusted remote ${trustedRemote}`);
      console.log(local);
      console.log(
        contractAngleOFT.interface.encodeFunctionData('setTrustedRemote', [(LZ_CHAINIDS as any)[chain], trustedRemote]),
      );

      console.log((LZ_CHAINIDS as any)[chain], trustedRemote);
      console.log('');
    }
  }
  console.log('--------------------------------------------');
  console.log('');
  /*
  console.log('Getting payloads to execute on all the other chains');
  console.log('--------------------------------------------');
  for (const chain of Object.keys(OFTs[stableName])) {
    if (chain !== network.name) {
      console.log(chain);
      const trustedRemote = ethers.utils.solidityPack(['address', 'address'], [local, OFTs[stableName][chain]]);
      console.log(`Trusted remote ${trustedRemote}`);
      console.log(OFTs[stableName][chain]);
      console.log(
        contractAngleOFT.interface.encodeFunctionData('setTrustedRemote', [
          (LZ_CHAINIDS as any)[network.name],
          trustedRemote,
        ]),
      );

      console.log((LZ_CHAINIDS as any)[network.name], trustedRemote);
      console.log('');
    }
  }
  console.log('--------------------------------------------');
  console.log('');
  */
};

func.tags = ['LayerZeroSources'];
export default func;
