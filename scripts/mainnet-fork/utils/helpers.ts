import { BigNumberish, BytesLike, ethers, BigNumber } from 'ethers';

export type Call = {
  action: number;
  data: BytesLike;
};

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
