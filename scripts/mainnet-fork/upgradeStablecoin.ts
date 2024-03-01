import { ChainId, registry } from '@angleprotocol/sdk/dist';
import { BigNumber, Contract } from 'ethers';
import { deployments, ethers, network } from 'hardhat';

import {
  ProxyAdmin,
  ProxyAdmin__factory,
  AgTokenSideChainMultiBridgeNameable,
  AgTokenSideChainMultiBridgeNameable__factory,
} from '../../typechain';

import { formatAmount } from '../../utils/bignumber';

import yargs from 'yargs';

const argv = yargs.env('').boolean('ci').parseSync();

async function main() {
  /**
   * This is a script to test the stablecoin upgrade for the Euro and the dollar.
   * For the actual upgrade we need to deploy:
   * 2 implems on Ethereum and Polygon (one corresponding to each token)
   * 1 implem on all other chains since agEUR and agUSD share the same implementation
   * It's important to make sure that the contract upgrade and name upgrade take place in the exact same transaction
   */

  const { deploy } = deployments;
  const { deployer } = await ethers.getNamedSigners();
  const deployerAddress = '0xfdA462548Ce04282f4B6D6619823a7C64Fdc0185';

  // TODO: can be changed
  const chainIdForked = ChainId.AVALANCHE;
  const stablecoin: 'EUR' | 'USD' = 'EUR';

  console.log(`Testing upgrade for chain ${chainIdForked} and ${stablecoin}`);

  let implementationName = 'AgTokenSideChainMultiBridgeNameable';
  let proxyAdminAddress = registry(chainIdForked)?.ProxyAdmin!;
  let governor = registry(chainIdForked)?.Governor!;
  let timelock = registry(chainIdForked)?.Timelock!;
  let stablecoinAddress = registry(chainIdForked)?.[`ag${stablecoin}`]?.AgToken!;
  //@ts-ignore
  if (chainIdForked === ChainId.MAINNET) {
    //@ts-ignore
    if (stablecoin === 'EUR') {
      implementationName = 'AgEURNameable';
    } else {
      implementationName = 'AgTokenNameable';
    }
    //@ts-ignore
  } else if (chainIdForked === ChainId.POLYGON && stablecoin === 'EUR') {
    implementationName = 'TokenPolygonUpgradeableNameable';
  }

  console.log(`The implementation used is ${implementationName} and proxy admin is ${proxyAdminAddress}`);
  console.log(`The stablecoin upgraded is ${stablecoinAddress}`);

  const proxyAdmin = new Contract(proxyAdminAddress, ProxyAdmin__factory.abi, deployer) as ProxyAdmin;
  const stableContract = new Contract(
    stablecoinAddress,
    AgTokenSideChainMultiBridgeNameable__factory.abi,
    deployer,
  ) as AgTokenSideChainMultiBridgeNameable;

  const res = await deploy('StablecoinNameable', {
    contract: implementationName,
    from: deployer.address,
    log: !argv.ci,
  });

  const upgradedAddress = res.address;
  console.log(`Implementation deployed at ${upgradedAddress}`);

  let signer;
  if (chainIdForked === ChainId.LINEA) {
    signer = await ethers.getSigner(timelock);
    await network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [timelock],
    });
    await network.provider.send('hardhat_setBalance', [timelock, '0x10000000000000000000000000000']);
    await proxyAdmin.connect(signer).upgrade(stablecoinAddress, upgradedAddress);
  } else {
    await network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [governor],
    });
    await network.provider.send('hardhat_setBalance', [governor, '0x10000000000000000000000000000']);
    signer = await ethers.getSigner(governor);
    await proxyAdmin.connect(signer).upgrade(stablecoinAddress, upgradedAddress);
  }

  console.log('Upgrade OK');
  if (stablecoin === 'USD') {
    await network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [governor],
    });
    await network.provider.send('hardhat_setBalance', [deployerAddress, '0x10000000000000000000000000000']);
    signer = await ethers.getSigner(deployerAddress);
  }

  await stableContract.connect(signer).setNameAndSymbol(`${stablecoin}A`, `${stablecoin}A`);
  console.log('Just updated the name and symbol');

  console.log('Treasury Address', await stableContract.treasury());
  console.log('New name', await stableContract.connect(signer).name());
  console.log('New symbol', await stableContract.symbol());
  console.log('Total supply', formatAmount.ether(await stableContract.totalSupply()));
  console.log('Deployer balance', formatAmount.ether(await stableContract.balanceOf(deployerAddress)));
  //@ts-ignore
  if (chainIdForked !== ChainId.MAINNET) {
    console.log('Chain hourly limit', formatAmount.ether(await stableContract.chainTotalHourlyLimit()));
    console.log('First bridge token address', await stableContract.bridgeTokensList(0));
  }

  // Checks of random holders
  let balance: BigNumber;
  let expectedBalance: BigNumber;
  if (stablecoin === 'EUR') {
    if (chainIdForked === ChainId.MAINNET) {
      balance = await stableContract.balanceOf('0xdC7Aa225964267c7E0EfB35f4931426209E90312');
      expectedBalance = BigNumber.from('39602307294411612343699');
      if (!balance.eq(expectedBalance)) {
        throw new Error(`Balance should be ${expectedBalance} but is ${balance}`);
      }
    } else if (chainIdForked === ChainId.POLYGON) {
      balance = await stableContract.balanceOf('0xBF1aC395731307E83cbF1901957ED0a4FAa15a02');
      expectedBalance = BigNumber.from('13098555244368954535152');
      if (!balance.eq(expectedBalance)) {
        throw new Error(`Balance should be ${expectedBalance} but is ${balance}`);
      }
    } else if (chainIdForked === ChainId.OPTIMISM) {
      balance = await stableContract.balanceOf('0x4be2cbe40521279b8fc561e65bb842bf73ec3a80');
      expectedBalance = BigNumber.from('175193898565986115917722');
      if (!balance.eq(expectedBalance)) {
        throw new Error(`Balance should be ${expectedBalance} but is ${balance}`);
      }
    } else if (chainIdForked === ChainId.ARBITRUM) {
      balance = await stableContract.balanceOf('0xa079a2828653c40340883d3fd50c705350ff5bdd');
      expectedBalance = BigNumber.from('47990229023153895444216');
      if (!balance.eq(expectedBalance)) {
        throw new Error(`Balance should be ${expectedBalance} but is ${balance}`);
      }
    } else if (chainIdForked === ChainId.GNOSIS) {
      balance = await stableContract.balanceOf('0x4c99dd8caaaca13d00311eb012addbbef91e50b0');
      expectedBalance = BigNumber.from('99487375287241425363');
      if (!balance.eq(expectedBalance)) {
        throw new Error(`Balance should be ${expectedBalance} but is ${balance}`);
      }
    } else if (chainIdForked === ChainId.LINEA) {
      balance = await stableContract.balanceOf('0x9e5d9f8b6b9a9293ef07970dab13cee3048bc3a2');
      expectedBalance = BigNumber.from('1560228105479611051535');
      if (!balance.eq(expectedBalance)) {
        throw new Error(`Balance should be ${expectedBalance} but is ${balance}`);
      }
    } else if (chainIdForked === ChainId.CELO) {
      balance = await stableContract.balanceOf('0x62fde8f6b12905f3ab1416e99c3d4d1872701c9f');
      expectedBalance = BigNumber.from('999000059274541694613');
      if (!balance.eq(expectedBalance)) {
        throw new Error(`Balance should be ${expectedBalance} but is ${balance}`);
      }
    } else if (chainIdForked === ChainId.BSC) {
      balance = await stableContract.balanceOf('0x4A5362ef534FFB27510E4E4C9A215BB5436377C2');
      expectedBalance = BigNumber.from('28808202615434194592393');
      if (!balance.eq(expectedBalance)) {
        throw new Error(`Balance should be ${expectedBalance} but is ${balance}`);
      }
    } else if (chainIdForked === ChainId.POLYGONZKEVM) {
      balance = await stableContract.balanceOf('0x390911260f68Db49470938dccD7213F313126cc4');
      expectedBalance = BigNumber.from('350000000000000000000');
      if (!balance.eq(expectedBalance)) {
        throw new Error(`Balance should be ${expectedBalance} but is ${balance}`);
      }
    } else if (chainIdForked === ChainId.BASE) {
      balance = await stableContract.balanceOf('0x05e0ef3feb4c88c9fca77d0c6b353e2dd73251fb');
      expectedBalance = BigNumber.from('685725878481193945031');
      if (!balance.eq(expectedBalance)) {
        throw new Error(`Balance should be ${expectedBalance} but is ${balance}`);
      }
    } else if (chainIdForked === ChainId.AVALANCHE) {
      balance = await stableContract.balanceOf('0xB4B0c97482C3CF08685307a2B917a35d5D531B93');
      expectedBalance = BigNumber.from('5361048966720791156851');
      if (!balance.eq(expectedBalance)) {
        throw new Error(`Balance should be ${expectedBalance} but is ${balance}`);
      }
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
