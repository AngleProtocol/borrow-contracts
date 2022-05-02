import { BigNumber, Signer } from 'ethers';
import { formatEther, parseEther } from 'ethers/lib/utils';
import { ethers } from 'hardhat';

import {
  AggregatorV3Interface,
  AggregatorV3Interface__factory,
  AgToken,
  BaseOracleChainlinkMulti,
  IOracle,
  Treasury,
  VaultManager,
} from '../../typechain';

async function main() {
  const vaultManagerAddress = (await ethers.getContract('VaultManager_wStETH_EUR')).address;
  const vaultManager = (await ethers.getContractAt('VaultManager', vaultManagerAddress)) as VaultManager;
  const { deployer } = await ethers.getNamedSigners();

  console.log('Address: ', deployer.address);

  const data = await vaultManager.vaultData(1);

  const oracleAddress = await vaultManager.oracle();
  const oracle = (await ethers.getContractAt('BaseOracleChainlinkMulti', oracleAddress)) as BaseOracleChainlinkMulti;

  console.log('BlockNumber: ', await deployer.provider?.getBlockNumber());
  //   console.log('Block: ', await deployer.provider?.getBlock(await deployer.provider?.getBlockNumber()));

  console.log('Stale Period: ', (await oracle.stalePeriod()).toString());

  const subOracle1 = (await ethers.getContractAt(
    AggregatorV3Interface__factory.abi,
    '0xCfE54B5cD566aB89272946F602D76Ea879CAb4a8',
  )) as AggregatorV3Interface;
  console.log('Sub Rate: ', (await subOracle1.latestRoundData()).toString());

  const subOracle2 = (await ethers.getContractAt(
    AggregatorV3Interface__factory.abi,
    '0xb49f677943BC038e9857d61E7d053CaA2C1734C1',
  )) as AggregatorV3Interface;
  console.log('Sub Rate: ', (await subOracle2.latestRoundData()).toString());

  console.log('Rate: ', (await oracle.read()).toString());

  console.log('Collateral: ', formatEther(data.collateralAmount));

  const stablecoinAddress = await vaultManager.stablecoin();
  const stablecoin = (await ethers.getContractAt('AgToken', stablecoinAddress)) as AgToken;

  console.log('Is Minter: ', await stablecoin.isMinter(vaultManagerAddress));

  //   const treasuryAddress = await vaultManager.treasury();
  //   const treasury = (await ethers.getContractAt('Treasury', treasuryAddress)) as Treasury;

  //   await (await treasury.connect(deployer).fetchSurplusFromAll()).wait();
  console.log('Surplus fetched');

  console.log('Interest Acc: ', (await vaultManager.interestAccumulator()).toString());
  console.log('Interest Rate: ', (await vaultManager.interestRate()).toString());

  console.log('Is Owner: ', (await vaultManager.isApprovedOrOwner(deployer.address, 1)).toString());

  console.log('Owner of existant: ', (await vaultManager.ownerOf(1)).toString());
  try {
    console.log('Owner of: ', (await vaultManager.ownerOf(100000)).toString());
  } catch (error) {
    console.log(error);
  }

  console.log('Debt Ceiling: ', (await vaultManager.debtCeiling()).toString());

  await (
    await vaultManager.connect(deployer)['angle(uint8[],bytes[],address,address)'](
      [2],
      [
        //   ethers.utils.defaultAbiCoder.encode(['address'], [deployer.address]),
        // ethers.utils.defaultAbiCoder.encode(
        //   ['uint256', 'uint256'],
        //   [1, BigNumber.from('1').mul(BigNumber.from(10).pow(18))],
        // ),
        ethers.utils.defaultAbiCoder.encode(
          ['uint256', 'uint256'],
          [10, BigNumber.from('1').mul(BigNumber.from(10).pow(18))],
        ),
      ],
      deployer.address,
      deployer.address,
      { gasLimit: 12e6 },
    )
  ).wait();

  console.log('Success');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
