import { deployments, ethers } from 'hardhat';
import { ChainId, CONTRACTS_ADDRESSES } from '@angleprotocol/sdk';
import { AngleRouter, AngleRouter__factory, VaultManager, VaultManager__factory } from '../../typechain';
import { expect } from '../../test/utils/chai-setup';
import { ERC20_Interface } from '@angleprotocol/sdk/dist/constants/interfaces';
import { Signer, BigNumber, BytesLike } from 'ethers';
import hre from 'hardhat';
import { MAX_UINT256 } from '../../test/utils/helpers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import {
  ActionType,
  TypeTransfer,
  TypeSwap,
  SwapType,
  TypePermit,
  addCollateral,
  borrow,
  createVault,
  encodeAngleBorrow,
  Call,
} from './utils/helpers';

async function main() {
  const { deployer } = await ethers.getNamedSigners();
  let routerAddress: string;
  let swapperAddress;
  let router: AngleRouter;
  let vaultManagerAddress: string;
  let vaultManager: VaultManager;
  let wstETHAddress: string;
  let agEURAddress: string;
  let signer: SignerWithAddress;
  let UNIT: BigNumber;
  let permits: TypePermit[];
  let transfers: TypeTransfer[];
  let swaps: TypeSwap[];
  let callsBorrow: Call[];
  let dataBorrow: BytesLike;
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
  const agEUR = new ethers.Contract(agEURAddress, ERC20_Interface, signer);
  vaultManagerAddress = (await deployments.get('VaultManager_wStETH_EUR')).address;
  swapperAddress = (await deployments.get('Swapper')).address;
  routerAddress = CONTRACTS_ADDRESSES[ChainId.MAINNET].AngleRouter!;
  router = new ethers.Contract(routerAddress, AngleRouter__factory.createInterface(), signer) as AngleRouter;
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

  console.log(`Success, added: ${(await vaultManager.vaultData(1)).collateralAmount.toString()} of wstETH`);

  // In order to borrow you need to give approval to the `router` to interact with your vault

  console.log('Giving approval to the router');
  await vaultManager.connect(signer).setApprovalForAll(routerAddress, true);
  console.log('Success');

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
  console.log(
    `Success, added: ${(await vaultManager.vaultData(2)).collateralAmount.toString()} of wstETH in the vault`,
  );
  console.log(`Stablecoin balance of the borrower is: ${(await agEUR.balanceOf(signer.address)).toString()}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
