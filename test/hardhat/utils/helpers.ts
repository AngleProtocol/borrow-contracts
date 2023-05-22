import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BigNumber, BigNumberish, BytesLike, Contract, ContractFactory, ContractTransaction, Signer } from 'ethers';
import { formatEther, formatUnits, parseUnits } from 'ethers/lib/utils';
import hre, { ethers } from 'hardhat';

import {
  IERC20Metadata,
  IOracle,
  TransparentUpgradeableProxy__factory,
  VaultManager,
  VaultManagerLiquidationBoost,
} from '../../../typechain';
import { expect } from '../utils/chai-setup';
import { TypePermit } from '../utils/sigUtils';

const BASE_PARAMS = parseUnits('1', 'gwei');

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

async function resetFork(options?: { blockNumber?: number; jsonRpcUrl?: string }): Promise<void> {
  const jsonRpcUrl = hre.config.networks.hardhat.forking?.url || options?.jsonRpcUrl;

  const params: {
    forking?: { jsonRpcUrl: string; blockNumber?: number };
  } = {
    forking: jsonRpcUrl
      ? {
          jsonRpcUrl,
        }
      : undefined,
  };

  if (params.forking && options?.blockNumber) {
    params.forking.blockNumber = options.blockNumber;
  }

  await hre.network.provider.request({
    method: 'hardhat_reset',
    params: [params],
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

// eslint-disable-next-line
async function deployUpgradeable(factory: ContractFactory, ...args: any[]): Promise<Contract> {
  const { deployer, proxyAdmin, alice } = await ethers.getNamedSigners();

  const Implementation = args.length === 0 ? await factory.deploy() : await factory.deploy(args[0], args[1]);
  const Proxy = await new TransparentUpgradeableProxy__factory(deployer).deploy(
    Implementation.address,
    proxyAdmin.address,
    '0x',
  );

  return new Contract(Proxy.address, factory.interface, alice);
}

async function expectApproxDelta(actual: BigNumber, expected: BigNumber, delta: BigNumber): Promise<void> {
  const margin = expected.div(delta);
  if (actual.isNegative()) {
    expect(expected.gte(actual.add(margin))).to.be.true;
    expect(expected.lte(actual.sub(margin))).to.be.true;
  } else {
    expect(expected.lte(actual.add(margin))).to.be.true;
    expect(expected.gte(actual.sub(margin))).to.be.true;
  }
}

function expectApprox(value: BigNumberish, target: BigNumberish, error: number): void {
  expect(value).to.be.lt(
    BigNumber.from(target)
      .mul((100 + error) * 1e10)
      .div(100 * 1e10),
  );
  expect(value).to.be.gt(
    BigNumber.from(target)
      .mul((100 - error) * 1e10)
      .div(100 * 1e10),
  );
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

function permit(permitData: TypePermit): Call {
  return {
    action: 7,
    data: ethers.utils.defaultAbiCoder.encode(
      ['address', 'uint256', 'uint256', 'uint256', 'bytes32', 'bytes32'],
      [permitData.owner, permitData.value, permitData.deadline, permitData.v, permitData.r, permitData.s],
    ),
  };
}

async function displayVaultState(
  vaultManager: VaultManager | VaultManagerLiquidationBoost,
  vaultID: BigNumberish,
  log: boolean,
  collatBase: number,
): Promise<void> {
  if (log) {
    const vault = await vaultManager.vaultData(vaultID);
    const debt = await vaultManager.getVaultDebt(vaultID);
    const rate = await ((await ethers.getContractAt('IOracle', await vaultManager.oracle())) as IOracle).read();

    console.log('');
    console.log('=============== Vault State ==============');
    console.log(
      `Debt:                      ${parseFloat(formatEther(debt)).toFixed(3)} -- $${parseFloat(
        formatEther(debt),
      ).toFixed(3)}`,
    );
    console.log(
      `Collateral:                ${parseFloat(formatUnits(vault.collateralAmount, collatBase)).toFixed(
        3,
      )} -- $${parseFloat(formatUnits(vault.collateralAmount.mul(rate), 18 + collatBase)).toFixed(3)}`,
    );
    vault.collateralAmount.gt(0) &&
      rate.gt(0) &&
      console.log(
        `CR:                        ${parseFloat(
          formatEther(
            debt
              .mul(parseUnits('1', 18 + collatBase))
              .div(rate)
              .div(vault.collateralAmount),
          ),
        ).toFixed(3)}`,
      );
    try {
      const params = await vaultManager.checkLiquidation(vaultID, ZERO_ADDRESS);
      console.log('============ Vault Liquidation ===========');
      console.log(`Max stablecoin to send:    ${formatEther(params.maxStablecoinAmountToRepay)}`);
      console.log(`Min stablecoin to send:    ${formatEther(params.thresholdRepayAmount)}`);
      console.log(`Collateral given:          ${formatUnits(params.maxCollateralAmountGiven, collatBase)}`);
      console.log(`Discount:                  ${(1 - params.discount.toNumber() / 1e9) * 100}%`);
    } catch {}
    console.log('==========================================');
    console.log('');
  }
}

async function angle(
  vaultManager: VaultManager | VaultManagerLiquidationBoost,
  signer: SignerWithAddress,
  calls: Call[],
  from: string = signer.address,
  to: string = from,
  who: string = ZERO_ADDRESS,
  repayData = '0x',
): Promise<ContractTransaction> {
  const actions: number[] = [];
  const datas: BytesLike[] = [];
  calls.forEach(o => {
    actions.push(o.action);
    datas.push(o.data);
  });
  if (who !== ZERO_ADDRESS) {
    return await vaultManager
      .connect(signer)
      ['angle(uint8[],bytes[],address,address,address,bytes)'](actions, datas, from, to, who, repayData);
  } else {
    return await vaultManager.connect(signer)['angle(uint8[],bytes[],address,address)'](actions, datas, from, to);
  }
}

async function angleUnprotected(
  vaultManager: VaultManager | VaultManagerLiquidationBoost,
  signer: SignerWithAddress,
  calls: Call[],
  from: string = signer.address,
  to: string = from,
  who: string = ZERO_ADDRESS,
  repayData = '0x',
): Promise<ContractTransaction> {
  const actions: number[] = [];
  const datas: BytesLike[] = [];
  calls.forEach(o => {
    actions.push(o.action);
    datas.push(o.data);
  });
  return await vaultManager
    .connect(signer)
    ['angle(uint8[],bytes[],address,address,address,bytes)'](actions, datas, from, to, who, repayData);
}

export {
  addCollateral,
  angle,
  angleUnprotected,
  balance,
  BASE_PARAMS,
  borrow,
  closeVault,
  createVault,
  deployUpgradeable,
  displayVaultState,
  expectApprox,
  expectApproxDelta,
  getDebtIn,
  getImpersonatedSigner,
  increaseTime,
  latestTime,
  MAX_UINT256,
  mine,
  permit,
  removeCollateral,
  repayDebt,
  resetFork,
  resetTime,
  setNextBlockTimestamp,
  time,
  ZERO_ADDRESS,
};
