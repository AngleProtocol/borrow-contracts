import { Contract } from 'ethers';
import { DeployFunction } from 'hardhat-deploy/types';

import { LayerZeroBridge, LayerZeroBridge__factory } from '../../typechain';
import { OFTs } from '../constants/constants';
import LZ_CHAINIDS from '../constants/layerzeroChainIds.json';

// For more details on trustedRemote, check: https://layerzero.gitbook.io/docs/evm-guides/master/set-trusted-remotes
// LayerZero chains: https://layerzero.gitbook.io/docs/technical-reference/mainnet/supported-chain-ids
// TODO make sure that the OFT table is up to date before running this script
const func: DeployFunction = async ({ ethers, network }) => {
  const { deployer } = await ethers.getNamedSigners();
  const stable = 'USD';

  let networkName = network.name;
  if (!network.live) networkName = 'mainnet';

  const local = OFTs[stable]?.[networkName] as string;
  const contractAngleOFT = new Contract(local, LayerZeroBridge__factory.abi, deployer) as LayerZeroBridge;

  console.log(`Setting the trusted remote addresses on ${networkName}`);
  console.log(`On this chain, the LZ address is ${local}`);
  console.log('--------------------------------------------');
  for (const chain of Object.keys(OFTs[stable])) {
    if (chain !== networkName) {
      console.log(`LZ ${stable} contract on ${chain} is ${OFTs[stable][chain]}`);
      const trustedRemote = ethers.utils.solidityPack(['address', 'address'], [OFTs[stable][chain], local]);
      console.log(
        'Encoded data',
        contractAngleOFT.interface.encodeFunctionData('setTrustedRemote', [(LZ_CHAINIDS as any)[chain], trustedRemote]),
      );
      console.log('LZ Chain ID & Trusted remote', (LZ_CHAINIDS as any)[chain], trustedRemote);
      console.log(`Now creating the transaction to connect ${chain} to ${networkName}`);
      // Check admin rights here
      await (
        await contractAngleOFT.connect(deployer).setTrustedRemote((LZ_CHAINIDS as any)[chain], trustedRemote)
      ).wait();
      console.log('Success');
      console.log('');
    }
  }
  console.log('--------------------------------------------');
  console.log('');
};

func.tags = ['lzSetupNewStable'];
export default func;
