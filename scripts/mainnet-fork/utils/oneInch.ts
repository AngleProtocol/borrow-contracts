import { Int256 } from '@angleprotocol/sdk';
import { get1inchSwapData } from './helpers';
import { ZERO_ADDRESS } from '../../../test/utils/helpers';

async function main() {
  const wstETHAddress = '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0';
  const agEURAddress = '0x1a7e4e63778B4f12a199C062f3eFdD288afCBce8';
  const usdcAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
  const aaveAddress = '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9';
  const stkAaveAddress = '0x4da27a545c0c5B758a6BA100e3a049001de870f5';
  const fxsAddress = '0x3432B6A60D23Ca0dFCa7761B7ab56459D9C964D0';
  const fraxAddress = '0x853d955aCEf822Db058eb8505911ED77F175b99e';
  const cUSDC = '0x39AA39c021dfbaE8faC545936693aC917d5E7563';
  // const amount = Int256.parse(20000, 18).raw.toString();
  // const amount = '20000000000000000000000';
  const amount = Int256.parse(1, 6).raw.toString();
  // const amount = '19999999999999999999999';

  const slippage = 10;

  const data = await get1inchSwapData(1, usdcAddress, agEURAddress, ZERO_ADDRESS, amount, slippage);

  console.log(data);
  console.log(data.tx.data);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
