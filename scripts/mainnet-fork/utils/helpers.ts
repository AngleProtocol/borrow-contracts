import { BigNumberish, BytesLike, ethers, BigNumber } from 'ethers';

export type Call = {
  action: number;
  data: BytesLike;
};

export function createVault(to: string): Call {
  return { action: 0, data: ethers.utils.defaultAbiCoder.encode(['address'], [to]) };
}

export function closeVault(vaultID: number): Call {
  return { action: 1, data: ethers.utils.defaultAbiCoder.encode(['uint256'], [vaultID]) };
}

export function addCollateral(vaultID: number, collateralAmount: BigNumberish): Call {
  return { action: 2, data: ethers.utils.defaultAbiCoder.encode(['uint256', 'uint256'], [vaultID, collateralAmount]) };
}

export function removeCollateral(vaultID: number, collateralAmount: BigNumberish): Call {
  return { action: 3, data: ethers.utils.defaultAbiCoder.encode(['uint256', 'uint256'], [vaultID, collateralAmount]) };
}

export function repayDebt(vaultID: number, stablecoinAmount: BigNumberish): Call {
  return { action: 4, data: ethers.utils.defaultAbiCoder.encode(['uint256', 'uint256'], [vaultID, stablecoinAmount]) };
}

export function borrow(vaultID: number, stablecoinAmount: BigNumberish): Call {
  return { action: 5, data: ethers.utils.defaultAbiCoder.encode(['uint256', 'uint256'], [vaultID, stablecoinAmount]) };
}

export function getDebtIn(
  vaultID: number,
  vaultManager: string,
  dstVaultID: number,
  stablecoinAmount: BigNumberish,
): Call {
  return {
    action: 6,
    data: ethers.utils.defaultAbiCoder.encode(
      ['uint256', 'address', 'uint256', 'uint256'],
      [vaultID, vaultManager, dstVaultID, stablecoinAmount],
    ),
  };
}

export function permit(permitData: TypePermit): Call {
  return {
    action: 7,
    data: ethers.utils.defaultAbiCoder.encode(
      ['address', 'uint256', 'uint256', 'uint256', 'bytes32', 'bytes32'],
      [permitData.owner, permitData.value, permitData.deadline, permitData.v, permitData.r, permitData.s],
    ),
  };
}

export enum ActionType {
  claimRewards,
  claimWeeklyInterest,
  gaugeDeposit,
  withdraw,
  mint,
  deposit,
  openPerpetual,
  addToPerpetual,
  veANGLEDeposit,
  borrower,
}
export enum SwapType {
  UniswapV3,
  oneINCH,
  WrapStETH,
  None,
}

export type TypePermit = {
  token: string;
  owner: string;
  value: BigNumber;
  deadline: number;
  v: number;
  r: Buffer;
  s: Buffer;
};

export type TypeSwap = {
  inToken: string;
  collateral: string;
  amountIn: BigNumber;
  minAmountOut: BigNumber;
  args: string;
  swapType: number;
};

export type TypeTransfer = {
  inToken: string;
  amountIn: BigNumber;
};

export function encodeAngleBorrow(
  collateral: string,
  stablecoin: string,
  vaultManager: string,
  to: string,
  who: string,
  repayData: BytesLike,
  calls: Call[],
): BytesLike {
  const actions: number[] = [];
  const data: BytesLike[] = [];
  calls.forEach(o => {
    actions.push(o.action);
    data.push(o.data);
  });

  return ethers.utils.defaultAbiCoder.encode(
    ['address', 'address', 'address', 'address', 'address', 'uint256[]', 'bytes[]', 'bytes'],
    [collateral, stablecoin, vaultManager, to, who, actions, data, repayData],
  );
}
