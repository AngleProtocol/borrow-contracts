import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BigNumber, BigNumberish, BytesLike, Contract, ContractFactory, Signer } from 'ethers';
import hre, { ethers } from 'hardhat';

import { TransparentUpgradeableProxy__factory, VaultManager } from '../../typechain';

async function getImpersonatedSigner(address: string): Promise<Signer> {
  await hre.network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [address],
  });

  const signer = await ethers.getSigner(address);

  return signer;
}

async function increaseTime(amount: number | string | BigNumberish): Promise<void> {
  await time.increase(amount);
}

async function resetTime(): Promise<void> {
  await resetFork();
}

async function resetFork(): Promise<void> {
  await hre.network.provider.request({
    method: 'hardhat_reset',
    params: [
      {
        forking: hre.config.networks.hardhat.forking
          ? {
              jsonRpcUrl: hre.config.networks.hardhat.forking.url,
            }
          : undefined,
      },
    ],
  });
}

async function setNextBlockTimestamp(time: number): Promise<void> {
  await hre.network.provider.request({
    method: 'evm_setNextBlockTimestamp',
    params: [time],
  });
}

async function latestTime(): Promise<number> {
  const { timestamp } = await ethers.provider.getBlock(await ethers.provider.getBlockNumber());

  return timestamp as number;
}

async function mine(): Promise<void> {
  await hre.network.provider.request({
    method: 'evm_mine',
  });
}

const ZERO_ADDRESS = ethers.constants.AddressZero;
const MAX_UINT256 = ethers.constants.MaxUint256;

const balance = {
  current: async (address: string): Promise<BigNumber> => {
    const balance = await ethers.provider.getBalance(address);
    return balance;
  },
};

const time = {
  latest: async (): Promise<number> => latestTime(),

  latestBlock: async (): Promise<number> => await ethers.provider.getBlockNumber(),

  increase: async (duration: number | string | BigNumberish): Promise<void> => {
    const durationBN = ethers.BigNumber.from(duration);

    if (durationBN.lt(ethers.constants.Zero)) throw Error(`Cannot increase time by a negative amount (${duration})`);

    await hre.network.provider.send('evm_increaseTime', [durationBN.toNumber()]);

    await hre.network.provider.send('evm_mine');
  },

  increaseTo: async (target: number | string | BigNumberish): Promise<void> => {
    const targetBN = ethers.BigNumber.from(target);

    const now = ethers.BigNumber.from(await time.latest());

    if (targetBN.lt(now)) throw Error(`Cannot increase current time (${now}) to a moment in the past (${target})`);
    const diff = targetBN.sub(now);
    return time.increase(diff);
  },

  advanceBlockTo: async (target: number | string | BigNumberish): Promise<void> => {
    target = ethers.BigNumber.from(target);

    const currentBlock = await time.latestBlock();
    const start = Date.now();
    let notified;
    if (target.lt(currentBlock))
      throw Error(`Target block #(${target}) is lower than current block #(${currentBlock})`);
    while (ethers.BigNumber.from(await time.latestBlock()).lt(target)) {
      if (!notified && Date.now() - start >= 5000) {
        notified = true;
        console.warn("You're advancing many blocks; this test may be slow.");
      }
      await time.advanceBlock();
    }
  },

  advanceBlock: async (): Promise<void> => {
    await hre.network.provider.send('evm_mine');
  },
};

async function deployUpgradeable(factory: ContractFactory): Promise<Contract> {
  const { deployer, proxyAdmin, alice } = await ethers.getNamedSigners();

  const Implementation = await factory.deploy();
  const Proxy = await new TransparentUpgradeableProxy__factory(deployer).deploy(
    Implementation.address,
    proxyAdmin.address,
    '0x',
  );

  return new Contract(Proxy.address, factory.interface, alice);
}

type Call = {
  action: number;
  data: BytesLike;
};

function createVault(to: string): Call {
  return { action: 0, data: ethers.utils.defaultAbiCoder.encode(['address'], [to]) };
}

function closeVault(vaultID: number): Call {
  return { action: 1, data: ethers.utils.defaultAbiCoder.encode(['uint256'], [vaultID]) };
}

function addCollateral(vaultID: number, collateralAmount: BigNumberish): Call {
  return { action: 2, data: ethers.utils.defaultAbiCoder.encode(['uint256', 'uint256'], [vaultID, collateralAmount]) };
}

function removeCollateral(vaultID: number, collateralAmount: BigNumberish): Call {
  return { action: 3, data: ethers.utils.defaultAbiCoder.encode(['uint256', 'uint256'], [vaultID, collateralAmount]) };
}

function repayDebt(vaultID: number, stablecoinAmount: BigNumberish): Call {
  return { action: 4, data: ethers.utils.defaultAbiCoder.encode(['uint256', 'uint256'], [vaultID, stablecoinAmount]) };
}

function borrow(vaultID: number, stablecoinAmount: BigNumberish): Call {
  return { action: 5, data: ethers.utils.defaultAbiCoder.encode(['uint256', 'uint256'], [vaultID, stablecoinAmount]) };
}

function getDebtIn(vaultID: number, vaultManager: string, dstVaultID: number, stablecoinAmount: BigNumberish): Call {
  return {
    action: 6,
    data: ethers.utils.defaultAbiCoder.encode(
      ['uint256', 'address', 'uint256', 'uint256'],
      [vaultID, vaultManager, dstVaultID, stablecoinAmount],
    ),
  };
}

async function angle(
  vaultManager: VaultManager,
  signer: SignerWithAddress,
  calls: Call[],
  from: string = signer.address,
  to: string = from,
  who: string = ZERO_ADDRESS,
  repayData = '0x',
): Promise<void> {
  const actions: number[] = [];
  const datas: BytesLike[] = [];
  calls.forEach(o => {
    actions.push(o.action);
    datas.push(o.data);
  });
  await vaultManager.connect(signer).angle(actions, datas, from, to, who, repayData);
}

export {
  addCollateral,
  angle,
  balance,
  borrow,
  closeVault,
  createVault,
  deployUpgradeable,
  getDebtIn,
  getImpersonatedSigner,
  increaseTime,
  latestTime,
  MAX_UINT256,
  mine,
  removeCollateral,
  repayDebt,
  resetFork,
  resetTime,
  setNextBlockTimestamp,
  time,
  ZERO_ADDRESS,
};
