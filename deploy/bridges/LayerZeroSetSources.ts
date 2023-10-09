import { Contract } from 'ethers';
import { DeployFunction } from 'hardhat-deploy/types';

import { LayerZeroBridge, LayerZeroBridge__factory } from '../../typechain';
import LZ_CHAINIDS from '../constants/layerzeroChainIds.json';

// For more details on trustedRemote, check: https://layerzero.gitbook.io/docs/evm-guides/master/set-trusted-remotes
// LayerZero chains: https://layerzero.gitbook.io/docs/technical-reference/mainnet/supported-chain-ids
const func: DeployFunction = async ({ ethers, network }) => {
  const { deployer } = await ethers.getNamedSigners();

  const OFTs: { [string: string]: string } = {
    polygon: '0x0c1EBBb61374dA1a8C57cB6681bF27178360d36F',
    optimism: '0x840b25c87B626a259CA5AC32124fA752F0230a72',
    arbitrum: '0x16cd38b1B54E7abf307Cb2697E2D9321e843d5AA',
    mainnet: '0x4Fa745FCCC04555F2AFA8874cd23961636CdF982',
    avalanche: '0x14C00080F97B9069ae3B4Eb506ee8a633f8F5434',
    bsc: '0xe9f183FC656656f1F17af1F2b0dF79b8fF9ad8eD',
    celo: '0xf1dDcACA7D17f8030Ab2eb54f2D9811365EFe123',
    gnosis: '0xFA5Ed56A203466CbBC2430a43c66b9D8723528E7',
    polygonzkevm: '0x2859a4eBcB58c8Dd5cAC1419C4F63A071b642B20',
    base: '0x2859a4eBcB58c8Dd5cAC1419C4F63A071b642B20',
    linea: '0x12f31B73D812C6Bb0d735a218c086d44D5fe5f89',
  };

  const local = OFTs[network.name];
  const contractAngleOFT = new Contract(local, LayerZeroBridge__factory.abi, deployer) as LayerZeroBridge;

  console.log('Getting payloads to execute on the new chain');
  console.log('--------------------------------------------');
  for (const chain of Object.keys(OFTs)) {
    if (chain !== network.name) {
      console.log(chain);
      const trustedRemote = ethers.utils.solidityPack(['address', 'address'], [OFTs[chain], local]);
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
  for (const chain of Object.keys(OFTs)) {
    if (chain !== network.name) {
      console.log(chain);
      const trustedRemote = ethers.utils.solidityPack(['address', 'address'], [local, OFTs[chain]]);
      console.log(`Trusted remote ${trustedRemote}`);
      console.log(OFTs[chain]);
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
