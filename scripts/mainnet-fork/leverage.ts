import { deployments, ethers } from 'hardhat';
import { ChainId, CONTRACTS_ADDRESSES, Interfaces } from '@angleprotocol/sdk';
import { VaultManager, VaultManager__factory, AgToken, AgToken__factory } from '../../typechain';
import { parseEther } from 'ethers/lib/utils';
import { expect } from '../../test/utils/chai-setup';
import { ERC20_Interface } from '@angleprotocol/sdk/dist/constants/interfaces';
import { Signer, BigNumber, BytesLike } from 'ethers';
import hre from 'hardhat';
import { MAX_UINT256, ZERO_ADDRESS } from '../../test/utils/helpers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import {
  ActionType,
  TypeTransfer,
  TypeSwap,
  SwapType,
  encodeAngleBorrow,
  Call,
  encodeSwapperCall,
} from './utils/helpers';
import { addCollateral, borrow, createVault } from '../../test/utils/helpers';
import { TypePermit } from '../../test/utils/sigUtils';
import { formatAmount } from '../../utils/bignumber';

async function main() {
  const { deployer } = await ethers.getNamedSigners();
  let routerAddress: string;
  let swapperAddress;
  let router;
  let agEUR: AgToken;
  let vaultManagerAddress: string;
  let vaultManager: VaultManager;
  let wstETHAddress: string;
  let agEURAddress: string;
  let signer: SignerWithAddress;
  let UNIT: BigNumber;
  let vaultIDCount: BigNumber;
  let permits: TypePermit[];
  let transfers: TypeTransfer[];
  let swaps: TypeSwap[];
  let callsBorrow: Call[];
  let dataBorrow: BytesLike;
  let repayData: BytesLike;
  let actions: ActionType[];
  let dataMixer: BytesLike[];

  UNIT = BigNumber.from(10).pow(18);
  // Address that owns a shit ton of wstETH
  const ownerAddress = '0xdaef20ea4708fcff06204a4fe9ddf41db056ba18';
  wstETHAddress = '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0';
  await hre.network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [ownerAddress],
  });
  await hre.network.provider.send('hardhat_setBalance', [ownerAddress, '0x10000000000000000000000000000']);
  signer = await ethers.getSigner(ownerAddress);
  agEURAddress = CONTRACTS_ADDRESSES[ChainId.MAINNET].agEUR.AgToken!;
  const wstETH = new ethers.Contract(wstETHAddress, ERC20_Interface, signer);
  agEUR = new ethers.Contract(agEURAddress, AgToken__factory.createInterface(), signer) as AgToken;
  vaultManagerAddress = (await deployments.get('VaultManager_wStETH_EUR')).address;
  swapperAddress = (await deployments.get('Swapper')).address;
  routerAddress = CONTRACTS_ADDRESSES[ChainId.MAINNET].AngleRouter!;
  router = new ethers.Contract(routerAddress, Interfaces.AngleRouter_Interface, signer);
  vaultManager = new ethers.Contract(
    vaultManagerAddress,
    VaultManager__factory.createInterface(),
    signer,
  ) as VaultManager;

  const allowance = await wstETH.allowance(signer.address, routerAddress);
  if (allowance == 0) {
    console.log('Approving the router');
    await (await wstETH.connect(signer).approve(routerAddress, MAX_UINT256)).wait();
    console.log('Success');
  } else {
    console.log('No need to approve the router, allowance is already non-null');
  }
  // In order to borrow you may need to give approval to the `router` to interact with your vault
  console.log('Giving approval to the router contract for the vaultManager');
  // Here we're not doing a permit to simplify the flow
  await vaultManager.connect(signer).setApprovalForAll(routerAddress, true);
  console.log('Success');

  const initBalance = await agEUR.balanceOf(signer.address);
  console.log(`Initial stablecoin balance of the borrower is: ${initBalance.toString()}`);
  console.log(`Signer address: ${signer.address}`);
  if (initBalance.gt(0)) {
    console.log('Burning the stablecoin to start from good balances');
    await agEUR.connect(signer).burnStablecoin(initBalance);
  }
  console.log('');
  console.log('Performing a simple deposit in a just created vault');
  permits = [];
  transfers = [{ inToken: wstETHAddress, amountIn: UNIT }];
  swaps = [];
  callsBorrow = [createVault(signer.address), addCollateral(0, UNIT)];
  dataBorrow = await encodeAngleBorrow(
    wstETHAddress,
    agEURAddress,
    vaultManagerAddress,
    signer.address,
    swapperAddress,
    '0x',
    callsBorrow,
  );
  actions = [ActionType.borrower];
  dataMixer = [dataBorrow];

  await router.connect(signer).mixer(permits, transfers, swaps, actions, dataMixer);

  vaultIDCount = await vaultManager.vaultIDCount();

  console.log(`Success, added: ${(await vaultManager.vaultData(vaultIDCount)).collateralAmount.toString()} of wstETH`);
  console.log('');
  console.log('Performing a deposit and borrow in a just created vault');
  permits = [];
  transfers = [{ inToken: wstETHAddress, amountIn: UNIT.mul(100) }];
  swaps = [];
  callsBorrow = [createVault(signer.address), addCollateral(0, UNIT.mul(100)), borrow(0, UNIT.mul(20000))];
  dataBorrow = await encodeAngleBorrow(
    wstETHAddress,
    agEURAddress,
    vaultManagerAddress,
    signer.address,
    swapperAddress,
    '0x',
    callsBorrow,
  );
  actions = [ActionType.borrower];
  dataMixer = [dataBorrow];

  await router.connect(signer).mixer(permits, transfers, swaps, actions, dataMixer);
  vaultIDCount = await vaultManager.vaultIDCount();
  console.log(
    `Success, added: ${(
      await vaultManager.vaultData(vaultIDCount)
    ).collateralAmount.toString()} of wstETH in the vault`,
  );
  console.log(`Stablecoin balance of the borrower is: ${(await agEUR.balanceOf(signer.address)).toString()}`);
  console.log('');
  console.log('Performing a deposit and a swap in a just created vault');
  const collateralBalancePrior = await wstETH.balanceOf(signer.address);

  permits = [];
  transfers = [{ inToken: wstETHAddress, amountIn: UNIT.mul(100) }];
  swaps = [];
  callsBorrow = [createVault(signer.address), addCollateral(0, UNIT.mul(106)), borrow(0, UNIT.mul(20000))];
  const oneInchData =
    '0xe449022e00000000000000000000000000000000000000000000043c33c19375647fffff000000000000000000000000000000000000000000000000535e5d9db6ef5e0000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000003000000000000000000000000735a26a57a0a0069dfabd41595a970faf5e1ee8b00000000000000000000000088e6a0c2ddd26feeb64f039a2c41296fcb3f5640800000000000000000000000d340b57aacdd10f96fc1cf10e15921936f41e29ccfee7c08';
  repayData = await encodeSwapperCall(ZERO_ADDRESS, ZERO_ADDRESS, parseEther('0'), 1, 0, oneInchData);

  dataBorrow = await encodeAngleBorrow(
    wstETHAddress,
    agEURAddress,
    vaultManagerAddress,
    swapperAddress,
    swapperAddress,
    repayData,
    callsBorrow,
  );
  actions = [ActionType.borrower];
  dataMixer = [dataBorrow];
  await router.connect(signer).mixer(permits, transfers, swaps, actions, dataMixer);
  vaultIDCount = await vaultManager.vaultIDCount();
  console.log(
    `Success, added: ${(
      await vaultManager.vaultData(vaultIDCount)
    ).collateralAmount.toString()} of wstETH in the vault`,
  );
  console.log(
    `Debt of the vault is: ${(
      await vaultManager.vaultData(vaultIDCount)
    ).normalizedDebt.toString()} of agEUR in the vault`,
  );
  const collateralBalanceAfter = await wstETH.balanceOf(signer.address);
  console.log(`Collateral balance evolution of the address is`);
  console.log(`${collateralBalancePrior.toString()}`);
  console.log(`${collateralBalanceAfter.toString()}`);
  console.log('The collateral balance decreased by:');
  console.log(formatAmount.ether(collateralBalancePrior.sub(collateralBalanceAfter)));
  console.log(`Initially brought ${UNIT.mul(100)}`);
  console.log(`Stablecoin balance of the borrower is: ${(await agEUR.balanceOf(signer.address)).toString()}`);
  console.log('');

  console.log('Taking a more significant leveraged position');
  const collateralBalancePrior2 = await wstETH.balanceOf(signer.address);

  permits = [];
  transfers = [{ inToken: wstETHAddress, amountIn: UNIT.mul(100) }];
  swaps = [];
  callsBorrow = [createVault(signer.address), addCollateral(0, UNIT.mul(290)), borrow(0, UNIT.mul(600001))];
  const oneInchData2 =
    '0x7c025200000000000000000000000000220bda5c8994804ac96ebe4df184d25e5c2196d4000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000001800000000000000000000000001a7e4e63778b4f12a199c062f3efdd288afcbce80000000000000000000000007f39c581f595b53c5cb19bd0b3f8da6c935e2ca0000000000000000000000000220bda5c8994804ac96ebe4df184d25e5c2196d40000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000007f0e10af47c1c700000000000000000000000000000000000000000000000000000a05cf9ad93ba4d36800000000000000000000000000000000000000000000000000000000000000050000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000038200000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000000500000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000aa000000000000000000000000000000000000000000000000000000000000030e000000000000000000000000000000000000000000000000000000000000033c000000000000000000000000000000000000000000000000000000000000035c0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000096414284aab000000000000000000000000000000000000000000000000000000000000008080000000000000000000000000000000000000000000000000000000000000240000000000000000000000001a7e4e63778b4f12a199c062f3efdd288afcbce8000000000000000000000000000000010000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000844aade5c4900000000000000000000000000000000000000000000000000000000000000e000000000000000000000000000000000000000000000000000000000000000010000000000000000000000001a7e4e63778b4f12a199c062f3efdd288afcbce80000000000000000000000007f39c581f595b53c5cb19bd0b3f8da6c935e2ca00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000220bda5c8994804ac96ebe4df184d25e5c2196d400000000000000000000000000000000000000000000000100edaace92045cd50000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000001e08000000000000000000000008db1b906d47dfc1d84a87fc49bd0522e285b98b9000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000104128acb08000000000000000000000000220bda5c8994804ac96ebe4df184d25e5c2196d40000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000cb49b44ba602d80000000000000000000000000000000000000000000000000000000000001000276a400000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000400000000000000000000000001a7e4e63778b4f12a199c062f3efd' +
    'd288afcbce8000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc20000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000004c4ad0e7b1a00000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000460000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc200000000000000000000000000000032000000000000000000000000000000320000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000001408000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000064eb5625d9000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000ba12222222228d8ba445958a75a0704d566bf2c8000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000800000000000000000000000ba12222222228d8ba445958a75a0704d566bf2c80000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000001e452bbbe2900000000000000000000000000000000000000000000000000000000000000e0000000000000000000000000220bda5c8994804ac96ebe4df184d25e5c2196d40000000000000000000000000000000000000000000000000000000000000000000000000000000000000000220bda5c8994804ac96ebe4df184d25e5c2196d40000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000626a588832296969ef14eb0c6d29669c550d4a04491302300002000000000000000000800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc20000000000000000000000007f39c581f595b53c5cb19bd0b3f8da6c935e2ca0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c0000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000028000000000000000000000000000000000000000000000000000000000000044800000000000000000000000000000000000000000000000000000000000016400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000025a414284aab000000000000000000000000000000000000000000000000000000000000008080000000000000000000000000000000000000000000000000000000000000240000000000000000000000001a7e4e63778b4f12a199c062f3efdd288afcbce800000000000000000000000000000009000000000000000000000000000000090000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000002484aade5c4900000000000000000000000000000000000000000000000000000000000000e00000000000000000' +
    '0000000000000000000000000000000000000000000000010000000000000000000000001a7e4e63778b4f12a199c062f3efdd288afcbce80000000000000000000000007f39c581f595b53c5cb19bd0b3f8da6c935e2ca00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000220bda5c8994804ac96ebe4df184d25e5c2196d400000000000000000000000000000000000000000000000904e1f00aa9a07693000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000001400000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000007400000000000000000000000000000000000000000000000000000000000000ca00000000000000000000000000000000000000000000000000000000000000f6000000000000000000000000000000000000000000000000000000000000012200000000000000000000000000000000000000000000000000000000000001c200000000000000000000000000000000000000000000000000000000000001e000000000000000000000000000000000000000000000000000000000000001fe0800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000022414284aab000000000000000000000000000000000000000000000000000000000000008080000000000000000000000000000000000000000000000000000000000000440000000000000000000000001a7e4e63778b4f12a199c062f3efdd288afcbce8000000000000000000000000000001c2000000000000000000000000000001c2800000000000000000000000735a26a57a0a0069dfabd41595a970faf5e1ee8b000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000104128acb08000000000000000000000000220bda5c8994804ac96ebe4df184d25e5c2196d40000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000001000276a400000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000400000000000000000000000001a7e4e63778b4f12a199c062f3efdd288afcbce8000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb480000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000016414284aab00000000000000000000000000000000000000000000000000000000000000808000000000000000000000000000000000000000000000000000000000000024000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb480000000000000000000000000000000400000000000000000000000000000032000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000044a9059cbb000000000000000000000000b4e16d0168e52d35cacd2c6185b44281ec28c9dc000000000000000000000' +
    '0000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000a4b757fed6000000000000000000000000b4e16d0168e52d35cacd2c6185b44281ec28c9dc000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc20000000000000000002dc6c0220bda5c8994804ac96ebe4df184d25e5c2196d400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000004c4ad0e7b1a00000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000460000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000000000000000000000000000000060000000000000000000000000000002e0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000001400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000064eb5625d9000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000000000000000000000000ba12222222228d8ba445958a75a0704d566bf2c8000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000000000000000000000ba12222222228d8ba445958a75a0704d566bf2c80000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000001e452bbbe2900000000000000000000000000000000000000000000000000000000000000e0000000000000000000000000220bda5c8994804ac96ebe4df184d25e5c2196d40000000000000000000000000000000000000000000000000000000000000000000000000000000000000000220bda5c8994804ac96ebe4df184d25e5c2196d40000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000626a588896646936b91d6b9d7d0c47c496afbf3d6ec7b6f80002000000000000000000190000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c0000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000028000000000000000000000000000000000000000000000000000000000000044800000000000000000000000000000000000000000000000000000000000016400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000022414284aab00000000000000000000000000000000000000000000000000000000000000808000000000000000000000000000000000000000000000000000000000000044000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb4800000000000000000000000000000010000000000000000000000000000000280000000000000000000000008ad599c3a0ff1de082011efddc58f1908eb6e6d8000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000104128acb08000000000000000000000000220bda5c8994804ac96ebe4df184d25e5c2196d40000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000001000276a400000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000040000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc20000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000022414284aab00000000000000000000000000000000000000000000000000000000000000808000000000000000000000000000000000000000000000000000000000000044000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000000000000000000000000000000180000000000000000000000000000001880000000000000000000000088e6a0c2ddd26feeb64f039a2c41296fcb3f5640000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000104128acb08000000000000000000000000220bda5c8994804ac96ebe4df184d25e5c2196d40000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000001000276a400000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000040000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000964ad0e7b1a00000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000900000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc200000000000000000000000000000023000000000000000000000000000000320000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000001400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000064eb5625d9000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000119c71d3bbac22029622cbaec24854d3d32d28280000' +
    '00000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000000000000000000000119c71d3bbac22029622cbaec24854d3d32d2828000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000684655d13cd00000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000006200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000125be0946000000000000000000000000ae7ab96520de3a18e5e111b5eaab095312d7fe84000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc20000000000000000000000003cbc3bed185b837d79ba18d36a3859ecbcfc3dc80000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001d460162f516f0000000000000000000000000000000000000000000000000001d45a17699b600800000000000000000000000000000000000000000000000000000000000000001e00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000022000000000000000000000000000000000000000000000000000000000000002a0000000000000000000000000000000000000000000000000000000000000032000000000000000000000000000000000000000000000000000000000000005400000000000000000000000000000000000000000000000000000000000000560000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000044f4a215c300000000000000000000000000000000000000000000001d460162f516f0000000000000000000000000000000000000000000000000001d45a17699b6008000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000044296637bf00000000000000000000000000000000000000000000001d460162f516f0000000000000000000000000000000000000000000000000001d45a17699b60080000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001e4961d5b1e000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000002000000000000000000000000119c71d3bbac22029622cbaec24854d3d32d2828000000000000000000000000119c71d3bbac22029622cbaec24854d3d32d2828000000000000000000000000000000000000000000000000000000000000000' +
    '2000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000044cf6fc6e30000000000000000000000003cbc3bed185b837d79ba18d36a3859ecbcfc3dc8000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002463592c2b00000000000000000000000000000000000000000000000000000000628f9f37000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004049a43fb864e0398535b7b4d394d571dbbadb206933ad01217a736e3a639d0ca65bcf5d6192c2a8ce66e463ccebcbd7e01bdae682714d61c5ca5b8f045926d6a80000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000028000000000000000000000000000000000000000000000000000000000000044800000000000000000000000000000000000000000000000000000000000006400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000014414284aab00000000000000000000000000000000000000000000000000000000000000808000000000000000000000000000000000000000000000000000000000000004000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc20000000000000000000000000000000f0000000000000000000000000000000f000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc20000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000242e1a7d4d00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000014414284aab00000000000000000000000000000000000000000000000000000000000000804000000000000000000000000000000000000000000000000000000000000004000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee0000000000000000000000000000000f0000000000000000000000000000000f800000000000000000000000ae7ab96520de3a18e5e111b5eaab095312d7fe84000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000024a1903eab00000000000000000000000042f527f50f16a103b6ccab48bccca214500c102100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000304ad0e7b1a000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000002a0000000000000000000000000ae7ab96520de3a18e5e111b5eaab095312d7fe8400000000000000000000000000000032000000000000000000000000000000320000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000001408000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000' +
    '000000000000000000000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000064eb5625d9000000000000000000000000ae7ab96520de3a18e5e111b5eaab095312d7fe840000000000000000000000007f39c581f595b53c5cb19bd0b3f8da6c935e2ca00000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000008000000000000000000000007f39c581f595b53c5cb19bd0b3f8da6c935e2ca0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000024ea598cb0000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000280000000000000000000000000000000000000000000000000000000000000448000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000024432ce0a7c00000000000000000000000000000000000000000000000000000000000000808000000000000000000000000000000000000000000000000000000000000044000000000000000000000000220bda5c8994804ac96ebe4df184d25e5c2196d400000000000000000000000000000000000000000000000000000000000001c000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000a4059712240000000000000000000000007f39c581f595b53c5cb19bd0b3f8da6c935e2ca00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000001000000000000000000000000000000010000000000000000000000000000000000000000000000000005c0824b173d3700000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004470bdb9470000000000000000000000007f39c581f595b53c5cb19bd0b3f8da6c935e2ca000000000000000000000000000000000000000000000000b22e6ac0dd07e403b0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000016414284aab0000000000000000000000000000000000000000000000000000000000000080a000000000000000000000000000000000000000000000000000000000000024000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc20000000000000000000000000000000100000000000000000000000000000001000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000044a9059cbb000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000018414284aab000000000000000000000000000000000000000000000000000000000000008080000000000000000000000000000000000000000000000000000000000000440000000000000000000000007f39c581f595b53c5cb19bd0b3f8da6c935e2ca000000000000000000000000000000001000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000064d1660f990000000000000000000000007f39c581f595b53c5cb19bd0b3f8da6c935e2ca00000000000000000000000001111111254fb6c44bac0bed2854e76f90643097d00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000cfee7c08';

  repayData = await encodeSwapperCall(ZERO_ADDRESS, ZERO_ADDRESS, parseEther('0'), 1, 0, oneInchData2);

  dataBorrow = await encodeAngleBorrow(
    wstETHAddress,
    agEURAddress,
    vaultManagerAddress,
    swapperAddress,
    swapperAddress,
    repayData,
    callsBorrow,
  );
  actions = [ActionType.borrower];
  dataMixer = [dataBorrow];
  await router.connect(signer).mixer(permits, transfers, swaps, actions, dataMixer);
  vaultIDCount = await vaultManager.vaultIDCount();
  console.log(
    `Success, added: ${(
      await vaultManager.vaultData(vaultIDCount)
    ).collateralAmount.toString()} of wstETH in the vault`,
  );
  console.log(
    `Debt of the vault is: ${(
      await vaultManager.vaultData(vaultIDCount)
    ).normalizedDebt.toString()} of agEUR in the vault`,
  );
  const collateralBalanceAfter2 = await wstETH.balanceOf(signer.address);
  console.log(`Collateral balance evolution of the address is`);
  console.log(`${collateralBalancePrior2.toString()}`);
  console.log(`${collateralBalanceAfter2.toString()}`);
  console.log('The collateral balance decreased by:');
  console.log(formatAmount.ether(collateralBalancePrior2.sub(collateralBalanceAfter2)));
  console.log(`Initially brought ${UNIT.mul(100)}`);
  console.log(`Stablecoin balance of the borrower is: ${(await agEUR.balanceOf(signer.address)).toString()}`);
  console.log('');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
