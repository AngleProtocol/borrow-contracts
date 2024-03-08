import { ChainId, registry } from '@angleprotocol/sdk/dist';
import { BigNumber, Contract } from 'ethers';
import { deployments, ethers, network } from 'hardhat';
import yargs from 'yargs';

import {
  AgEUR,
  AgEUR__factory,
  AgTokenSideChainMultiBridgeNameable,
  AgTokenSideChainMultiBridgeNameable__factory,
  ProxyAdmin,
  ProxyAdmin__factory,
} from '../../typechain';
import { formatAmount } from '../../utils/bignumber';

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
  const deployerAddress = deployer.address;

  // TODO: can be changed
  const chainId = ChainId.POLYGON;
  const stablecoin: 'EUR' | 'USD' = 'EUR';

  console.log(`Testing upgrade for chain ${chainId} and ${stablecoin}`);

  let implementationName = 'AgTokenSideChainMultiBridgeNameable';
  let contractName = 'AngleStablecoinSideChainMultiBridge';

  const proxyAdminAddress = registry(chainId)?.ProxyAdmin!;
  const governor = registry(chainId)?.Governor!;
  const timelock = registry(chainId)?.Timelock!;
  const stablecoinAddress = registry(chainId)?.[`ag${stablecoin}`]?.AgToken!;

  // @ts-ignore
  if (chainId === ChainId.MAINNET) {
    // @ts-ignore
    if (stablecoin === 'EUR') {
      implementationName = 'AgEURNameable';
      contractName = 'EURAngleStablecoin';
    } else {
      implementationName = 'AgTokenNameable';
      contractName = 'AngleStablecoin';
    }
    // @ts-ignore
  } else if (chainId === ChainId.POLYGON && stablecoin === 'EUR') {
    implementationName = 'TokenPolygonUpgradeableNameable';
    contractName = 'AngleStablecoinPolygon';
  }

  console.log(`The governor address is ${governor}`);
  console.log(`The timelock address is ${timelock}`);
  console.log(`The implementation used is ${implementationName} and proxy admin is ${proxyAdminAddress}`);
  console.log(`The stablecoin upgraded is ${stablecoinAddress}`);

  const proxyAdmin = new Contract(proxyAdminAddress, ProxyAdmin__factory.abi, deployer) as ProxyAdmin;
  const stableContract = new Contract(
    stablecoinAddress,
    AgTokenSideChainMultiBridgeNameable__factory.abi,
    deployer,
  ) as AgTokenSideChainMultiBridgeNameable;

  const res = await deploy(contractName, {
    contract: implementationName,
    from: deployer.address,
    log: !argv.ci,
  });

  const upgradedAddress = res.address;
  console.log(`Implementation deployed at ${upgradedAddress}`);

  let signer;
  if (chainId === ChainId.LINEA) {
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
    // await network.provider.request({
    //   method: 'hardhat_impersonateAccount',
    //   params: [governor],
    // });
    await network.provider.send('hardhat_setBalance', [deployerAddress, '0x10000000000000000000000000000']);
    signer = await ethers.getSigner(deployerAddress);
  }

  await stableContract.connect(signer).setNameAndSymbol(`${stablecoin}A`, `${stablecoin}A`);
  console.log('Just updated the name and symbol');

  const treasuryAddress = await stableContract.treasury();
  if (treasuryAddress !== registry(chainId)?.[`ag${stablecoin}`]?.Treasury!) {
    throw new Error(`Treasury should be ${registry(chainId)?.[`ag${stablecoin}`]?.Treasury} but is ${treasuryAddress}`);
  } else console.log('Treasury Address ', treasuryAddress);

  const newName = await stableContract.name();
  // @ts-ignore
  const trueName = stablecoin === 'USD' ? 'USDA' : 'EURA';
  if (newName !== trueName) {
    throw new Error(`Name should be ${trueName} but is ${newName}`);
  } else console.log('New name ', newName);

  const newSymbol = await stableContract.symbol();
  // @ts-ignore
  const trueSymbol = stablecoin === 'USD' ? 'USDA' : 'EURA';
  if (newSymbol !== trueSymbol) {
    throw new Error(`Symbol should be ${trueSymbol} but is ${newSymbol}`);
  } else console.log('New symbol ', newSymbol);

  const governorIsMinter = await stableContract.isMinter(governor);
  if (governorIsMinter !== false) {
    throw new Error(`Governor should not be a minter`);
  } else console.log('Governor is not a minter');

  const treasuryIsMinter = await stableContract.isMinter(treasuryAddress);
  if (treasuryIsMinter !== false) {
    throw new Error(`Treasury should not be a minter`);
  } else console.log('Treasury is not a minter');

  const deployerIsMinter = await stableContract.isMinter(deployerAddress);
  if (deployerIsMinter !== false) {
    throw new Error(`Deployer should not be a minter`);
  } else console.log('Deployer is not a minter');

  console.log('Total supply', formatAmount.ether(await stableContract.totalSupply()));
  console.log('Deployer balance', formatAmount.ether(await stableContract.balanceOf(deployerAddress)));

  if (chainId === ChainId.MAINNET) {
    // @ts-ignore
    if (stablecoin === 'EUR') {
      const agEURContract = new Contract(stablecoinAddress, AgEUR__factory.abi, deployer) as AgEUR;
      const treasuryInit = await agEURContract.treasuryInitialized();
      if (treasuryInit !== true) {
        throw new Error(`treasuryInitialized should be true`);
      } else console.log('Treasury Initialized ', treasuryInit);
    }
  } else {
    const bridgeTokens = await stableContract.allBridgeTokens();
    if (bridgeTokens.length !== 1 || bridgeTokens[0] !== registry(chainId)?.[`ag${stablecoin}`]?.bridges?.LayerZero) {
      throw new Error(`Bridge token should be ${bridgeTokens}`);
    } else console.log('Bridge token is LayerZero ', bridgeTokens);

    const bridgeInfo = await stableContract.bridges(bridgeTokens[0]);
    if (!bridgeInfo.fee.eq(BigNumber.from('0')) || bridgeInfo.allowed !== true || bridgeInfo.paused !== false) {
      throw new Error(`Bridge token info ${bridgeInfo}`);
    } else console.log('Bridge token info ', bridgeInfo);

    console.log('Chain hourly limit', formatAmount.ether(await stableContract.chainTotalHourlyLimit()));
  }

  // Checks of random holders
  let balance: BigNumber;
  let expectedBalance: BigNumber;
  if (stablecoin === 'EUR') {
    if (chainId === ChainId.MAINNET) {
      balance = await stableContract.balanceOf('0xdC7Aa225964267c7E0EfB35f4931426209E90312');
      expectedBalance = BigNumber.from('39602307294411612343699');
      if (!balance.eq(expectedBalance)) {
        throw new Error(`Balance should be ${expectedBalance} but is ${balance}`);
      }
    } else if (chainId === ChainId.POLYGON) {
      balance = await stableContract.balanceOf('0xBF1aC395731307E83cbF1901957ED0a4FAa15a02');
      expectedBalance = BigNumber.from('13098555244368954535152');
      if (!balance.eq(expectedBalance)) {
        throw new Error(`Balance should be ${expectedBalance} but is ${balance}`);
      }
    } else if (chainId === ChainId.OPTIMISM) {
      balance = await stableContract.balanceOf('0x4be2cbe40521279b8fc561e65bb842bf73ec3a80');
      expectedBalance = BigNumber.from('175193898565986115917722');
      if (!balance.eq(expectedBalance)) {
        throw new Error(`Balance should be ${expectedBalance} but is ${balance}`);
      }
    } else if (chainId === ChainId.ARBITRUM) {
      balance = await stableContract.balanceOf('0x4cb6F0ef0Eeb503f8065AF1A6E6D5DD46197d3d9');
      expectedBalance = BigNumber.from('10192159719759421795706');
      if (!balance.eq(expectedBalance)) {
        throw new Error(`Balance should be ${expectedBalance} but is ${balance}`);
      }
    } else if (chainId === ChainId.GNOSIS) {
      balance = await stableContract.balanceOf('0x4c99dd8caaaca13d00311eb012addbbef91e50b0');
      expectedBalance = BigNumber.from('99487375287241425363');
      if (!balance.eq(expectedBalance)) {
        throw new Error(`Balance should be ${expectedBalance} but is ${balance}`);
      }
    } else if (chainId === ChainId.LINEA) {
      balance = await stableContract.balanceOf('0x9e5d9f8b6b9a9293ef07970dab13cee3048bc3a2');
      expectedBalance = BigNumber.from('1560228105479611051535');
      if (!balance.eq(expectedBalance)) {
        throw new Error(`Balance should be ${expectedBalance} but is ${balance}`);
      }
    } else if (chainId === ChainId.CELO) {
      balance = await stableContract.balanceOf('0x62fde8f6b12905f3ab1416e99c3d4d1872701c9f');
      expectedBalance = BigNumber.from('999000059274541694613');
      if (!balance.eq(expectedBalance)) {
        throw new Error(`Balance should be ${expectedBalance} but is ${balance}`);
      }
    } else if (chainId === ChainId.BSC) {
      balance = await stableContract.balanceOf('0x4A5362ef534FFB27510E4E4C9A215BB5436377C2');
      expectedBalance = BigNumber.from('28808202615434194592393');
      if (!balance.eq(expectedBalance)) {
        throw new Error(`Balance should be ${expectedBalance} but is ${balance}`);
      }
    } else if (chainId === ChainId.POLYGONZKEVM) {
      balance = await stableContract.balanceOf('0x390911260f68Db49470938dccD7213F313126cc4');
      expectedBalance = BigNumber.from('350000000000000000000');
      if (!balance.eq(expectedBalance)) {
        throw new Error(`Balance should be ${expectedBalance} but is ${balance}`);
      }
    } else if (chainId === ChainId.BASE) {
      balance = await stableContract.balanceOf('0x05e0ef3feb4c88c9fca77d0c6b353e2dd73251fb');
      expectedBalance = BigNumber.from('685725878481193945031');
      if (!balance.eq(expectedBalance)) {
        throw new Error(`Balance should be ${expectedBalance} but is ${balance}`);
      }
    } else if (chainId === ChainId.AVALANCHE) {
      balance = await stableContract.balanceOf('0xB4B0c97482C3CF08685307a2B917a35d5D531B93');
      expectedBalance = BigNumber.from('5361048966720791156851');
      if (!balance.eq(expectedBalance)) {
        throw new Error(`Balance should be ${expectedBalance} but is ${balance}`);
      }
    }
  }

  // This checks are done at the end because on USD it depends on the chain
  // @ts-ignore
  const isNotMinter = stablecoin === 'USD' && chainId === ChainId.MAINNET;

  const FlashLoanIsMinter = await stableContract.isMinter(registry(chainId)?.FlashAngle!);
  if (FlashLoanIsMinter === isNotMinter) {
    throw new Error(`FlashLoan is minter: ${FlashLoanIsMinter}`);
  } else console.log(`FlashLoan is minter: ${FlashLoanIsMinter}`);

  const timelockIsMinter = await stableContract.isMinter(timelock);
  if (timelockIsMinter === isNotMinter) {
    throw new Error(`Timelock is minter: ${timelockIsMinter}`);
  } else console.log(`Timelock is minter: ${timelockIsMinter}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
