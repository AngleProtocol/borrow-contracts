import { Int256 } from '@angleprotocol/sdk';
import { get1inchSwapData } from './helpers';
import { ZERO_ADDRESS } from '../../../test/utils/helpers';

async function main() {
  const wstETHAddress = '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0';
  const agEURAddress = '0x1a7e4e63778B4f12a199C062f3eFdD288afCBce8';
  const usdcAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
  // const amount = Int256.parse(20000, 18).raw.toString();
  // const amount = '20000000000000000000000';
  const amount = Int256.parse(63000, 6).raw.toString();
  // const amount = '19999999999999999999999';

  const slippage = 10;

  const data = await get1inchSwapData(1, usdcAddress, wstETHAddress, ZERO_ADDRESS, amount, slippage);

  console.log(data);
  console.log(data.tx.data);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
