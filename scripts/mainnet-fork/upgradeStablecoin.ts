import { ChainId, registry } from '@angleprotocol/sdk/dist';
import { BigNumber, Contract } from 'ethers';
import { deployments, ethers, network } from 'hardhat';

import {
  ProxyAdmin,
  ProxyAdmin__factory,
  AgTokenSideChainMultiBridgeNameable,
  AgTokenSideChainMultiBridgeNameable__factory
} from '../../typechain';

import { formatAmount } from '../../utils/bignumber';

import yargs from 'yargs';

const argv = yargs.env('').boolean('ci').parseSync();

async function main() {

  const { deploy } = deployments;
  const { deployer } = await ethers.getNamedSigners();
const deployerAddress = '0xfdA462548Ce04282f4B6D6619823a7C64Fdc0185'

    // TODO: can be changed
  let chainIdForked: ChainId = ChainId.POLYGON;
  const stablecoin: 'EUR' | 'USD' = 'USD';

  console.log(`Testing upgrade for chain ${chainIdForked} and ${stablecoin}`)


    let implementationName = 'AgTokenSideChainMultiBridgeNameable';
    let proxyAdminAddress = registry(chainIdForked)?.ProxyAdmin!
    let governor = registry(chainIdForked)?.Governor!
    let stablecoinAddress = registry(chainIdForked)?.[`ag${stablecoin}`]?.AgToken!
    //@ts-ignore
  if(chainIdForked === ChainId.MAINNET) {
    //@ts-ignore
    if (stablecoin === 'EUR') {
        implementationName = 'AgEURNameable';
    } else {
        implementationName = 'AgTokenNameable'
    }
//@ts-ignore
  } else if(chainIdForked === ChainId.POLYGON && stablecoin === 'EUR') {
    implementationName = 'TokenPolygonUpgradeableNameable';
  }

  console.log(`The implementation used is ${implementationName} and proxy admin is ${proxyAdminAddress}`)
  console.log(`The stablecoin upgraded is ${stablecoinAddress}`)

  const proxyAdmin = new Contract(proxyAdminAddress, ProxyAdmin__factory.abi, deployer) as ProxyAdmin;
  const stableContract = new Contract(stablecoinAddress,AgTokenSideChainMultiBridgeNameable__factory.abi, deployer) as AgTokenSideChainMultiBridgeNameable

  await deploy('StablecoinNameable', {
    contract: implementationName,
    from: deployer.address,
    log: !argv.ci,
  });

  const upgradedAddress = (await deployments.get('StablecoinNameable')).address
  console.log(`Implementation deployed at ${upgradedAddress}`)

  await network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [governor],
  });
  await network.provider.send('hardhat_setBalance', [governor, '0x10000000000000000000000000000']);

  let signer = await ethers.getSigner(governor);

  await proxyAdmin.connect(signer).upgrade(stablecoinAddress, upgradedAddress);

  console.log('Upgrade OK');
  if(stablecoin === 'USD') {
    await network.provider.request({
        method: 'hardhat_impersonateAccount',
        params: [governor],
      });
    await network.provider.send('hardhat_setBalance', [deployerAddress, '0x10000000000000000000000000000']);
    signer = await ethers.getSigner(deployerAddress)
  }

  await stableContract.connect(signer).setNameAndSymbol(`${stablecoin}A`,`${stablecoin}A`)
  console.log('Just updated the name and symbol')


  console.log('Treasury Address',await stableContract.treasury());
  console.log('New name',await stableContract.name());
  console.log('New symbol',await stableContract.symbol());
  console.log('Total supply',formatAmount.ether((await stableContract.totalSupply())));
  console.log('Deployer balance',formatAmount.ether(await stableContract.balanceOf(deployerAddress)));
//@ts-ignore
  if(chainIdForked!==ChainId.MAINNET) {
    console.log('Chain hourly limit',formatAmount.ether(await stableContract.chainTotalHourlyLimit()))
    console.log('First bridge token address', await stableContract.bridgeTokensList(0))
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
