import { ether } from '@angleprotocol/sdk';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import axios from 'axios';
import { BigNumber, Contract, utils, Wallet } from 'ethers';
import { ethers, network } from 'hardhat';
import { task } from 'hardhat/config';
import qs from 'qs';

import { DsProxyMulticallTarget, DsProxyMulticallTarget__factory, IERC20, IERC20__factory } from '../../typechain';
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

async function populateTx(
  contract: Contract,
  functionName: string,
  args?: any[],
  isCallingItself = false,
): Promise<{
  target: string;
  data: string;
  isCallingItself?: boolean;
}> {
  const tx = await contract.populateTransaction[functionName](...(args || []));
  if (!tx.to || !tx.data) {
    throw new Error(`data not formatted properly: ${JSON.stringify(tx)}`);
  }

  return {
    target: tx.to,
    data: tx.data,
    isCallingItself: isCallingItself,
  };
}

describe('DSProxy', async () => {
  let deployer: SignerWithAddress, user1: SignerWithAddress, user2: SignerWithAddress;
  let randomUser: string;

  let taskExecutor: DsProxyMulticallTarget;
  let USDC: IERC20;
  let strat: Contract;

  beforeEach(async () => {
    await network.provider.request({
      method: 'hardhat_reset',
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.ETH_NODE_URI_FORK,
            blockNumber: 14578338,
          },
        },
      ],
    });

    [deployer, user1, user2] = await ethers.getSigners();

    taskExecutor = (await (
      await ethers.getContractFactory('DsProxyMulticallTarget')
    ).deploy()) as DsProxyMulticallTarget;

    expect(await taskExecutor.owner()).to.equal(deployer.address);

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

  it('AccessControl', async () => {
    await USDC.connect(deployer).transfer(taskExecutor.address, utils.parseUnits('10000', 6));
    const tx = await populateTx(USDC, 'transfer', [user2.address, 10]);
    expect(taskExecutor.connect(user1).executeActions([tx], 0)).to.be.revertedWith('Ownable: caller is not the owner');
  });

  it('Array of tasks cannot be empty', async () => {
    expect(taskExecutor.connect(deployer).executeActions([], 0)).to.be.revertedWith('InvalidLength');
  });

  it('withdrawStuckFunds', async () => {
    await expect(
      taskExecutor.connect(user1).withdrawStuckFunds(USDC.address, randomUser, utils.parseUnits('1000', 6)),
    ).to.be.revertedWith('Ownable: caller is not the owner');

    await USDC.connect(deployer).transfer(taskExecutor.address, utils.parseUnits('1000', 6));
    await deployer.sendTransaction({
      value: utils.parseEther('10'),
      to: taskExecutor.address,
    });

    expect(await ethers.provider.getBalance(taskExecutor.address)).to.equal(utils.parseEther('10'));
    expect(await USDC.connect(deployer).balanceOf(taskExecutor.address)).to.equal(utils.parseUnits('1000', 6));

    expect(await ethers.provider.getBalance(randomUser)).to.equal(0);
    expect(await USDC.connect(deployer).balanceOf(randomUser)).to.equal(0);

    await taskExecutor.connect(deployer).withdrawStuckFunds(USDC.address, randomUser, utils.parseUnits('1000', 6));
    await taskExecutor
      .connect(deployer)
      .withdrawStuckFunds('0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', randomUser, utils.parseEther('10'));
    expect(await ethers.provider.getBalance(randomUser)).to.equal(utils.parseEther('10'));
    expect(await USDC.connect(deployer).balanceOf(randomUser)).to.equal(utils.parseUnits('1000', 6));
  });

  it('kill contract', async () => {
    expect(taskExecutor.connect(user1).kill()).to.be.revertedWith('Ownable: caller is not the owner');

    await deployer.sendTransaction({
      value: utils.parseEther('10'),
      to: taskExecutor.address,
    });

    expect(await ethers.provider.getBalance(taskExecutor.address)).to.equal(utils.parseEther('10'));
    expect(await taskExecutor.owner()).to.equal(deployer.address);

    expect(await ethers.provider.getBalance(deployer.address)).to.be.closeTo(
      utils.parseEther('9990'),
      utils.parseEther('0.01'),
    );
    await taskExecutor.connect(deployer).kill();
    expect(await ethers.provider.getBalance(deployer.address)).to.be.closeTo(
      utils.parseEther('10000'),
      utils.parseEther('0.01'),
    );

    expect(await ethers.provider.getBalance(taskExecutor.address)).to.equal(0);

    await expect(taskExecutor.owner()).to.be.reverted;
  });

  it('Chain multiple random txs', async () => {
    await USDC.connect(deployer).transfer(taskExecutor.address, 100000000);

    const tx1 = await populateTx(USDC, 'transfer', [user2.address, 1_000_000]);
    const tx2 = await populateTx(strat, 'harvest');

    const payload1Inch = await get1inchSwapData(
      1,
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      taskExecutor.address,
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

    expect(await ethers.provider.getBalance(taskExecutor.address)).to.equal(0);

    expect(await USDC.connect(deployer).balanceOf(taskExecutor.address)).to.equal(utils.parseUnits('100', 6));
    expect(await USDC.connect(deployer).balanceOf(user2.address)).to.equal(0);

    await (await taskExecutor.connect(deployer).executeActions([tx1, tx2, tx3, tx4], 0)).wait();

    expect(parseFloat(utils.formatEther(await ethers.provider.getBalance(taskExecutor.address)))).to.be.closeTo(
      0.00033,
      0.0001,
    );
    expect(await USDC.connect(deployer).balanceOf(taskExecutor.address)).to.equal(utils.parseUnits('98', 6));
    expect(await USDC.connect(deployer).balanceOf(user2.address)).to.equal(utils.parseUnits('1', 6));
  });

  it('Pay Flashbots 1', async () => {
    await USDC.connect(deployer).transfer(taskExecutor.address, utils.parseUnits('10000', 6));
    const payload1Inch = await get1inchSwapData(
      1,
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      taskExecutor.address,
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
    const tx3 = await populateTx(taskExecutor, 'payFlashbots', [utils.parseEther('1')], true);

    expect(await ethers.provider.getBalance(randomUser)).to.equal(0);

    const receipt = await (await taskExecutor.connect(deployer).executeActions([tx1, tx2, tx3], 0)).wait();

    const miner = (await ethers.provider.getBlock(receipt.blockHash)).miner;
    const balanceBefore = await ethers.provider.getBalance(miner, receipt.blockNumber - 1);
    const currentBalance = await ethers.provider.getBalance(miner, receipt.blockNumber);

    const log = receipt.events?.reduce((returnValue, _log) => {
      try {
        const log = DsProxyMulticallTarget__factory.createInterface().parseLog(_log);
        return log;
      } catch (e) {}
      return returnValue;
    }, {} as utils.LogDescription | undefined);

    expect(log?.args.value).to.equal(utils.parseEther('1'));

    // the block reward is around 2ETH, so we subtract it
    expect(currentBalance.sub(balanceBefore).sub(utils.parseEther('2'))).to.be.closeTo(
      log?.args.value,
      utils.parseEther('0.1'),
    );

    expect(await ethers.provider.getBalance(taskExecutor.address)).to.be.closeTo(
      utils.parseEther('2.2'),
      utils.parseEther('0.1'),
    );
    expect(await USDC.connect(deployer).balanceOf(taskExecutor.address)).to.equal(0);
  });

  it('Pay Flashbots 2', async () => {
    await USDC.connect(deployer).transfer(taskExecutor.address, utils.parseUnits('10000', 6));
    const payload1Inch = await get1inchSwapData(
      1,
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      taskExecutor.address,
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

    expect(await ethers.provider.getBalance(taskExecutor.address)).to.equal(0);

    const receipt = await (await taskExecutor.connect(deployer).executeActions([tx1, tx2], 1000)).wait();

    const miner = (await ethers.provider.getBlock(receipt.blockHash)).miner;
    const balanceBefore = await ethers.provider.getBalance(miner, receipt.blockNumber - 1);
    const currentBalance = await ethers.provider.getBalance(miner, receipt.blockNumber);

    const log = receipt.events?.reduce((returnValue, _log) => {
      try {
        const log = DsProxyMulticallTarget__factory.createInterface().parseLog(_log);
        return log;
      } catch (e) {}
      return returnValue;
    }, {} as utils.LogDescription | undefined);

    const swapAmountOut = BigNumber.from(payload1Inch.toTokenAmount);
    const approximateAmountSentToMiner = swapAmountOut.div(10);
    expect(approximateAmountSentToMiner).to.be.closeTo(log?.args.value, utils.parseEther('0.01'));

    expect(currentBalance.sub(balanceBefore).sub(utils.parseEther('2'))).to.be.closeTo(
      approximateAmountSentToMiner,
      utils.parseEther('0.01'),
    );

    expect(await ethers.provider.getBalance(taskExecutor.address)).to.be.closeTo(
      swapAmountOut.sub(approximateAmountSentToMiner),
      utils.parseEther('0.05'),
    );
  });
  it('Pay Flashbots 3', async () => {
    await USDC.connect(deployer).transfer(taskExecutor.address, utils.parseUnits('10000', 6));
    const payload1Inch = await get1inchSwapData(
      1,
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      taskExecutor.address,
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

    const receipt = await (await taskExecutor.connect(deployer).executeActions([tx1, tx2], 625)).wait();

    const miner = (await ethers.provider.getBlock(receipt.blockHash)).miner;
    const balanceBefore = await ethers.provider.getBalance(miner, receipt.blockNumber - 1);
    const currentBalance = await ethers.provider.getBalance(miner, receipt.blockNumber);

    const log = receipt.events?.reduce((returnValue, _log) => {
      try {
        const log = DsProxyMulticallTarget__factory.createInterface().parseLog(_log);
        return log;
      } catch (e) {}
      return returnValue;
    }, {} as utils.LogDescription | undefined);

    const swapAmountOut = BigNumber.from(payload1Inch.toTokenAmount);
    const approximateAmountSentToMiner = swapAmountOut.div(100 / 6.25);
    expect(approximateAmountSentToMiner).to.be.closeTo(log?.args.value, utils.parseEther('0.01'));

    expect(currentBalance.sub(balanceBefore).sub(utils.parseEther('2'))).to.be.closeTo(
      approximateAmountSentToMiner,
      utils.parseEther('0.01'),
    );

    expect(await ethers.provider.getBalance(taskExecutor.address)).to.be.closeTo(
      swapAmountOut.sub(approximateAmountSentToMiner),
      utils.parseEther('0.06'),
    );
  });

  it('Swap tokens', async () => {
    await USDC.connect(deployer).transfer(taskExecutor.address, utils.parseUnits('10000', 6));
    let payload1Inch = await get1inchSwapData(
      1,
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      taskExecutor.address,
      utils.parseUnits('1000', 6).toString(),
      10,
    );

    const txApprove = await populateTx(
      taskExecutor,
      'approve',
      [
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        '0x1111111254fb6c44bAC0beD2854e76F90643097d',
        utils.parseUnits('10000', 6),
      ],
      true,
    );
    let txSwap = await populateTx(taskExecutor, 'swapToken', [0, payload1Inch.tx.data], true);

    expect(taskExecutor.connect(deployer).executeActions([txSwap], 0)).to.be.revertedWith(
      'action reverted: Error(ERC20: transfer amount exceeds allowance)',
    );
    await taskExecutor.connect(deployer).executeActions([txApprove, txSwap], 0);

    payload1Inch = await get1inchSwapData(
      1,
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      taskExecutor.address,
      utils.parseUnits('1000', 6).toString(),
      10,
    );
    txSwap = await populateTx(taskExecutor, 'swapToken', [payload1Inch.toTokenAmount, payload1Inch.tx.data], true);
    expect(taskExecutor.connect(deployer).executeActions([txSwap], 0)).to.be.reverted;
  });
});
