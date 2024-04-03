import { ChainId, registry } from '@angleprotocol/sdk/dist';
import { BigNumber, Contract } from 'ethers';
import { deployments, ethers, network } from 'hardhat';
import yargs from 'yargs';

import {
  AgTokenSideChainMultiBridgeNameable,
  AgTokenSideChainMultiBridgeNameable__factory,
} from '../../typechain';

const argv = yargs.env('').boolean('ci').parseSync();

async function main() {
  const { deployer } = await ethers.getNamedSigners();
  const chainId = ChainId.MAINNET;
  const stablecoinAddress = registry(chainId)?.agEUR?.AgToken!;
  const stableContract = new Contract(
    stablecoinAddress,
    AgTokenSideChainMultiBridgeNameable__factory.abi,
    deployer,
  ) as AgTokenSideChainMultiBridgeNameable;

    console.log(await stableContract.name())
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
