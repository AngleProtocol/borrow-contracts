import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import axios from 'axios';
import { Contract, utils, Wallet } from 'ethers';
import { ethers, network } from 'hardhat';
import qs from 'qs';

import {
  DSProxy,
  DSProxyCache,
  DsProxyMulticallTarget,
  DsProxyMulticallTarget__factory,
  IERC20,
  IERC20__factory,
} from '../../typechain';
import { expect } from '../utils/chai-setup';

export async function get1inchSwapData(
  chainId: number,
  fromTokenAddress: string,
  toTokenAddress: string,
  fromAddress: string,
  amount: string,
  slippage: number,
) {
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

type EncodeForMulticall = {
  to: string;
  data: string;
  isCallingItself?: boolean;
};

function encodeForMulticall(_calls: EncodeForMulticall[], value: number, receiver: string) {
  const calls = _calls.map(_call => ({
    _target: _call.to,
    _data: _call.data,
    isCallingItself: _call.isCallingItself || false,
  }));
  const task = DsProxyMulticallTarget__factory.createInterface().encodeFunctionData('executeActions', [
    calls,
    value,
    receiver,
  ]);
  return task;
}

async function populateTx(
  contract: Contract,
  functionName: string,
  args?: any[],
  isCallingItself = false,
): Promise<EncodeForMulticall> {
  const tx = (await contract.populateTransaction[functionName](...(args || []))) as EncodeForMulticall;
  if (!tx.to || !tx.data) {
    throw new Error(`data not formatted properly: ${JSON.stringify(tx)}`);
  }

  tx.isCallingItself = isCallingItself;

  return tx as EncodeForMulticall;
}

describe('DSProxy', async () => {
  let deployer: SignerWithAddress, user1: SignerWithAddress, user2: SignerWithAddress;
  let randomUser: string;

  let dsproxy: DSProxy;
  let dsproxyCache: DSProxyCache;
  let taskExecutor: DsProxyMulticallTarget;
  let USDC: IERC20;
  let strat: Contract;

  beforeEach(async () => {
    [deployer, user1, user2] = await ethers.getSigners();

    dsproxyCache = (await (await ethers.getContractFactory('DSProxyCache')).deploy()) as DSProxyCache;
    taskExecutor = (await (
      await ethers.getContractFactory('DsProxyMulticallTarget')
    ).deploy()) as DsProxyMulticallTarget;
    dsproxy = (await (await ethers.getContractFactory('DSProxy')).deploy(dsproxyCache.address)) as DSProxy;

    expect(await dsproxy.owner()).to.equal(deployer.address);

    // SETUP
    await network.provider.send('hardhat_setStorageAt', [
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      utils.solidityKeccak256(['uint256', 'uint256'], [deployer.address, 9]).replace('0x0', '0x'),
      utils.hexZeroPad(utils.parseUnits((1_000_000).toString(), 6).toHexString(), 32),
    ]);

    USDC = new Contract('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', IERC20__factory.abi) as IERC20;
    strat = new Contract('0x5fE0E497Ac676d8bA78598FC8016EBC1E6cE14a3', ['function harvest() external']);
    randomUser = Wallet.createRandom().address;
  });

  it('Test 1', async () => {
    await USDC.connect(deployer).transfer(dsproxy.address, 100000000);

    const tx1 = await populateTx(USDC, 'transfer', [user2.address, 1_000_000]);
    const tx2 = await populateTx(strat, 'harvest');

    const payload1Inch = await get1inchSwapData(
      1,
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      dsproxy.address,
      utils.parseUnits('1', 6).toString(),
      10,
    );

    const tx3 = await populateTx(
      taskExecutor,
      'approve',
      [
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        '0x1111111254fb6c44bAC0beD2854e76F90643097d',
        utils.parseUnits('1000', 6),
      ],
      true,
    );
    const tx4 = await populateTx(taskExecutor, 'swapToken', [0, payload1Inch.tx.data], true);

    const executeTask = encodeForMulticall([tx1, tx2, tx3, tx4], 0, randomUser);

    expect(await ethers.provider.getBalance(dsproxy.address)).to.equal(0);

    expect(await USDC.connect(deployer).balanceOf(dsproxy.address)).to.equal(utils.parseUnits('100', 6));
    expect(await USDC.connect(deployer).balanceOf(user2.address)).to.equal(0);

    await (await dsproxy.connect(deployer)['execute(address,bytes)'](taskExecutor.address, executeTask)).wait();

    expect(parseFloat(utils.formatEther(await ethers.provider.getBalance(dsproxy.address)))).to.be.closeTo(
      0.00033,
      0.0001,
    );
    expect(await USDC.connect(deployer).balanceOf(dsproxy.address)).to.equal(utils.parseUnits('98', 6));
    expect(await USDC.connect(deployer).balanceOf(user2.address)).to.equal(utils.parseUnits('1', 6));
  });

  it('Pay Flashbots 1', async () => {
    await USDC.connect(deployer).transfer(dsproxy.address, utils.parseUnits('10000', 6));
    const payload1Inch = await get1inchSwapData(
      1,
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      dsproxy.address,
      utils.parseUnits('10000', 6).toString(),
      10,
    );

    const tx1 = await populateTx(
      taskExecutor,
      'approve',
      [
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        '0x1111111254fb6c44bAC0beD2854e76F90643097d',
        utils.parseUnits('10000', 6),
      ],
      true,
    );
    const tx2 = await populateTx(taskExecutor, 'swapToken', [0, payload1Inch.tx.data], true);
    const tx3 = await populateTx(taskExecutor, 'payFlashbots', [utils.parseEther('1'), randomUser], true);

    expect(await ethers.provider.getBalance(randomUser)).to.equal(0);

    const executeTask = encodeForMulticall([tx1, tx2, tx3], 0, randomUser);
    await (await dsproxy.connect(deployer)['execute(address,bytes)'](taskExecutor.address, executeTask)).wait();

    expect(await ethers.provider.getBalance(randomUser)).to.equal(utils.parseEther('1'));
    expect(await ethers.provider.getBalance(dsproxy.address)).to.be.closeTo(
      utils.parseEther('2.2'),
      utils.parseEther('0.1'),
    );
    expect(await USDC.connect(deployer).balanceOf(dsproxy.address)).to.equal(0);
  });

  it.only('Pay Flashbots 2', async () => {
    await USDC.connect(deployer).transfer(dsproxy.address, utils.parseUnits('10000', 6));
    const payload1Inch = await get1inchSwapData(
      1,
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      dsproxy.address,
      utils.parseUnits('10000', 6).toString(),
      10,
    );

    const tx1 = await populateTx(
      taskExecutor,
      'approve',
      [
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        '0x1111111254fb6c44bAC0beD2854e76F90643097d',
        utils.parseUnits('10000', 6),
      ],
      true,
    );
    const tx2 = await populateTx(taskExecutor, 'swapToken', [0, payload1Inch.tx.data], true);

    expect(await ethers.provider.getBalance(randomUser)).to.equal(0);

    const executeTask = encodeForMulticall([tx1, tx2], 1000, randomUser);
    await (await dsproxy.connect(deployer)['execute(address,bytes)'](taskExecutor.address, executeTask)).wait();

    const expectedBalance = utils.parseEther('3.24');
    expect(await ethers.provider.getBalance(randomUser)).to.be.closeTo(
      expectedBalance.div(10),
      utils.parseEther('0.01'),
    );
    expect(await ethers.provider.getBalance(dsproxy.address)).to.be.closeTo(
      expectedBalance.mul(9).div(10),
      utils.parseEther('0.01'),
    );

    // expect(await ethers.provider.getBalance(randomUser)).to.equal(utils.parseEther('1'));
    // expect(await ethers.provider.getBalance(dsproxy.address)).to.be.closeTo(
    //   utils.parseEther('2.2'),
    //   utils.parseEther('0.1'),
    // );
    // expect(await USDC.connect(deployer).balanceOf(dsproxy.address)).to.equal(0);
  });
});
