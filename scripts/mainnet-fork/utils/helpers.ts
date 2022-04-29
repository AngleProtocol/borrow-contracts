import { BigNumberish, BytesLike, ethers, BigNumber } from 'ethers';
import axios from 'axios';
import qs from 'qs';

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

export function encodeSwapperCall(
  intermediateToken: string,
  to: string,
  minAmountOut: BigNumber,
  swapType: number,
  mintOrBurn: number,
  path: BytesLike,
): BytesLike {
  return ethers.utils.defaultAbiCoder.encode(
    ['address', 'address', 'uint256', 'uint128', 'uint128', 'bytes'],
    [intermediateToken, to, minAmountOut, swapType, mintOrBurn, path],
  );
}

export async function get1inchSwapData(
  chainId: number,
  fromTokenAddress: string,
  toTokenAddress: string,
  fromAddress: string,
  amount: string,
  slippage: number,
): Promise<any> {
  const oneInchParams = qs.stringify({
    fromTokenAddress,
    toTokenAddress,
    fromAddress,
    amount,
    slippage,
    disableEstimate: true,
  });
  const url = `https://api.1inch.exchange/v4.0/${chainId}/swap?${oneInchParams}`;

  const res = await axios.get(url);
  return res.data;
}
