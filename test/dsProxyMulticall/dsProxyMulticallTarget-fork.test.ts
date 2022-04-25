import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import axios from 'axios';
import { BigNumber, Contract, utils, Wallet } from 'ethers';
import { ethers, network } from 'hardhat';
import qs from 'qs';

import {
  IERC20,
  IERC20__factory,
  KeeperMulticall,
  KeeperMulticall__factory,
  TransparentUpgradeableProxy,
} from '../../typechain';
import { expect } from '../utils/chai-setup';

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

async function populateTx(
  contract: Contract,
  functionName: string,
  args?: any[],
  isDelegateCall = false,
): Promise<{
  target: string;
  data: string;
  isDelegateCall?: boolean;
}> {
  const tx = await contract.populateTransaction[functionName](...(args || []));
  if (!tx.to || !tx.data) {
    throw new Error(`data not formatted properly: ${JSON.stringify(tx)}`);
  }

  return {
    target: tx.to,
    data: tx.data,
    isDelegateCall: isDelegateCall,
  };
}

describe('DSProxy', async () => {
  let deployer: SignerWithAddress, user1: SignerWithAddress, user2: SignerWithAddress, proxyAdmin: SignerWithAddress;
  let randomUser: string;

  let keeperMulticall: KeeperMulticall;
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

    [deployer, user1, user2, proxyAdmin] = await ethers.getSigners();

    const keeperMulticallImplementation = await (await ethers.getContractFactory('KeeperMulticall')).deploy();
    const initializeData = KeeperMulticall__factory.createInterface().encodeFunctionData('initialize');
    const proxy = await (
      await ethers.getContractFactory('TransparentUpgradeableProxy')
    ).deploy(keeperMulticallImplementation.address, proxyAdmin.address, initializeData);
    keeperMulticall = new Contract(
      proxy.address,
      [...KeeperMulticall__factory.abi, 'function upgradeTo(address newImplementation) external'],
      deployer,
    ) as KeeperMulticall;

    expect(await keeperMulticall.hasRole(await keeperMulticall.KEEPER_ROLE(), deployer.address)).to.be.true;

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
    await USDC.connect(deployer).transfer(keeperMulticall.address, utils.parseUnits('10000', 6));
    const tx = await populateTx(USDC, 'transfer', [user2.address, 10]);
    expect(keeperMulticall.connect(user1).executeActions([tx], 0)).to.be.revertedWith(
      `AccessControl: account ${user1.address.toLowerCase()} is missing role ${await (
        await keeperMulticall.KEEPER_ROLE()
      ).toLowerCase()}`,
    );
  });

  it('Upgrade', async () => {
    await deployer.sendTransaction({
      value: utils.parseEther('10'),
      to: keeperMulticall.address,
    });
    const balanceBefore = await ethers.provider.getBalance(keeperMulticall.address);

    const newImplementation = await (await ethers.getContractFactory('KeeperMulticall')).deploy();
    await expect(
      (keeperMulticall as unknown as TransparentUpgradeableProxy).connect(user1).upgradeTo(newImplementation.address),
    ).to.be.reverted;
    await (keeperMulticall as unknown as TransparentUpgradeableProxy)
      .connect(proxyAdmin)
      .upgradeTo(newImplementation.address);

    expect(await ethers.provider.getBalance(keeperMulticall.address)).to.equal(balanceBefore);
  });

  it('Array of tasks cannot be empty', async () => {
    expect(keeperMulticall.connect(deployer).executeActions([], 0)).to.be.revertedWith('IncompatibleLengths');
  });

  it('withdrawStuckFunds', async () => {
    await expect(
      keeperMulticall.connect(user1).withdrawStuckFunds(USDC.address, randomUser, utils.parseUnits('1000', 6)),
    ).to.be.revertedWith(
      `AccessControl: account ${user1.address.toLowerCase()} is missing role ${await (
        await keeperMulticall.KEEPER_ROLE()
      ).toLowerCase()}`,
    );

    await USDC.connect(deployer).transfer(keeperMulticall.address, utils.parseUnits('1000', 6));
    await deployer.sendTransaction({
      value: utils.parseEther('10'),
      to: keeperMulticall.address,
    });

    expect(await ethers.provider.getBalance(keeperMulticall.address)).to.equal(utils.parseEther('10'));
    expect(await USDC.connect(deployer).balanceOf(keeperMulticall.address)).to.equal(utils.parseUnits('1000', 6));

    expect(await ethers.provider.getBalance(randomUser)).to.equal(0);
    expect(await USDC.connect(deployer).balanceOf(randomUser)).to.equal(0);

    await keeperMulticall.connect(deployer).withdrawStuckFunds(USDC.address, randomUser, utils.parseUnits('1000', 6));
    await keeperMulticall
      .connect(deployer)
      .withdrawStuckFunds('0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', randomUser, utils.parseEther('10'));
    expect(await ethers.provider.getBalance(randomUser)).to.equal(utils.parseEther('10'));
    expect(await USDC.connect(deployer).balanceOf(randomUser)).to.equal(utils.parseUnits('1000', 6));
  });

  it('Chain multiple random txs', async () => {
    await USDC.connect(deployer).transfer(keeperMulticall.address, 100000000);

    const tx1 = await populateTx(USDC, 'transfer', [user2.address, 1_000_000]);
    const tx2 = await populateTx(strat, 'harvest');

    const payload1Inch = await get1inchSwapData(
      1,
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      keeperMulticall.address,
      utils.parseUnits('1', 6).toString(),
      10,
    );

    const tx3 = await populateTx(
      keeperMulticall,
      'approve',
      [
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        '0x1111111254fb6c44bAC0beD2854e76F90643097d',
        utils.parseUnits('1000', 6),
      ],
      true,
    );
    const tx4 = await populateTx(keeperMulticall, 'swapToken', [0, payload1Inch.tx.data], true);

    expect(await ethers.provider.getBalance(keeperMulticall.address)).to.equal(0);

    expect(await USDC.connect(deployer).balanceOf(keeperMulticall.address)).to.equal(utils.parseUnits('100', 6));
    expect(await USDC.connect(deployer).balanceOf(user2.address)).to.equal(0);

    await (await keeperMulticall.connect(deployer).executeActions([tx1, tx2, tx3, tx4], 0)).wait();

    expect(parseFloat(utils.formatEther(await ethers.provider.getBalance(keeperMulticall.address)))).to.be.closeTo(
      0.00033,
      0.0001,
    );
    expect(await USDC.connect(deployer).balanceOf(keeperMulticall.address)).to.equal(utils.parseUnits('98', 6));
    expect(await USDC.connect(deployer).balanceOf(user2.address)).to.equal(utils.parseUnits('1', 6));
  });

  it('Pay Flashbots 1', async () => {
    await USDC.connect(deployer).transfer(keeperMulticall.address, utils.parseUnits('10000', 6));
    const payload1Inch = await get1inchSwapData(
      1,
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      keeperMulticall.address,
      utils.parseUnits('10000', 6).toString(),
      10,
    );

    const tx1 = await populateTx(
      keeperMulticall,
      'approve',
      [
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        '0x1111111254fb6c44bAC0beD2854e76F90643097d',
        utils.parseUnits('10000', 6),
      ],
      true,
    );
    const tx2 = await populateTx(keeperMulticall, 'swapToken', [0, payload1Inch.tx.data], true);
    const tx3 = await populateTx(keeperMulticall, 'payFlashbots', [utils.parseEther('1')], true);

    expect(await ethers.provider.getBalance(randomUser)).to.equal(0);

    const receipt = await (await keeperMulticall.connect(deployer).executeActions([tx1, tx2, tx3], 0)).wait();

    const miner = (await ethers.provider.getBlock(receipt.blockHash)).miner;
    const balanceBefore = await ethers.provider.getBalance(miner, receipt.blockNumber - 1);
    const currentBalance = await ethers.provider.getBalance(miner, receipt.blockNumber);

    const log = receipt.events?.reduce((returnValue, _log) => {
      try {
        const log = KeeperMulticall__factory.createInterface().parseLog(_log);
        if (log.eventFragment.name !== 'SentToMiner') return returnValue;
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

    expect(await ethers.provider.getBalance(keeperMulticall.address)).to.be.closeTo(
      utils.parseEther('2.2'),
      utils.parseEther('0.1'),
    );
    expect(await USDC.connect(deployer).balanceOf(keeperMulticall.address)).to.equal(0);
  });

  it.only('Pay Flashbots 2', async () => {
    await USDC.connect(deployer).transfer(keeperMulticall.address, utils.parseUnits('10000', 6));
    const payload1Inch = await get1inchSwapData(
      1,
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      keeperMulticall.address,
      utils.parseUnits('10000', 6).toString(),
      10,
    );

    const tx1 = await populateTx(
      keeperMulticall,
      'approve',
      [
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        '0x1111111254fb6c44bAC0beD2854e76F90643097d',
        utils.parseUnits('10000', 6),
      ],
      true,
    );
    const tx2 = await populateTx(keeperMulticall, 'swapToken', [0, payload1Inch.tx.data], true);

    expect(await ethers.provider.getBalance(keeperMulticall.address)).to.equal(0);

    const receipt = await (await keeperMulticall.connect(deployer).executeActions([tx1, tx2], 1000)).wait();

    const miner = (await ethers.provider.getBlock(receipt.blockHash)).miner;
    const balanceBefore = await ethers.provider.getBalance(miner, receipt.blockNumber - 1);
    const currentBalance = await ethers.provider.getBalance(miner, receipt.blockNumber);

    const log = receipt.events?.reduce((returnValue, _log) => {
      try {
        const log = KeeperMulticall__factory.createInterface().parseLog(_log);
        if (log.name !== 'SentToMiner') return returnValue;
        return log;
      } catch (e) {}
      return returnValue;
    }, {} as utils.LogDescription | undefined);

    const swapAmountOut = BigNumber.from(payload1Inch.toTokenAmount);
    const approximateAmountSentToMiner = swapAmountOut.div(10);

    console.log(payload1Inch, log?.args);
    expect(approximateAmountSentToMiner).to.be.closeTo(log?.args.value, utils.parseEther('0.01'));

    expect(currentBalance.sub(balanceBefore).sub(utils.parseEther('2'))).to.be.closeTo(
      approximateAmountSentToMiner,
      utils.parseEther('0.01'),
    );

    expect(await ethers.provider.getBalance(keeperMulticall.address)).to.be.closeTo(
      swapAmountOut.sub(approximateAmountSentToMiner),
      utils.parseEther('0.05'),
    );
  });
  it('Pay Flashbots 3', async () => {
    await USDC.connect(deployer).transfer(keeperMulticall.address, utils.parseUnits('10000', 6));
    const payload1Inch = await get1inchSwapData(
      1,
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      keeperMulticall.address,
      utils.parseUnits('10000', 6).toString(),
      10,
    );

    const tx1 = await populateTx(
      keeperMulticall,
      'approve',
      [
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        '0x1111111254fb6c44bAC0beD2854e76F90643097d',
        utils.parseUnits('10000', 6),
      ],
      true,
    );
    const tx2 = await populateTx(keeperMulticall, 'swapToken', [0, payload1Inch.tx.data], true);

    const receipt = await (await keeperMulticall.connect(deployer).executeActions([tx1, tx2], 625)).wait();

    const miner = (await ethers.provider.getBlock(receipt.blockHash)).miner;
    const balanceBefore = await ethers.provider.getBalance(miner, receipt.blockNumber - 1);
    const currentBalance = await ethers.provider.getBalance(miner, receipt.blockNumber);

    const log = receipt.events?.reduce((returnValue, _log) => {
      try {
        const log = KeeperMulticall__factory.createInterface().parseLog(_log);
        if (log.eventFragment.name !== 'SentToMiner') return returnValue;
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

    expect(await ethers.provider.getBalance(keeperMulticall.address)).to.be.closeTo(
      swapAmountOut.sub(approximateAmountSentToMiner),
      utils.parseEther('0.06'),
    );
  });

  it('Swap tokens', async () => {
    await USDC.connect(deployer).transfer(keeperMulticall.address, utils.parseUnits('10000', 6));
    let payload1Inch = await get1inchSwapData(
      1,
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      keeperMulticall.address,
      utils.parseUnits('1000', 6).toString(),
      10,
    );

    const txApprove = await populateTx(
      keeperMulticall,
      'approve',
      [
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        '0x1111111254fb6c44bAC0beD2854e76F90643097d',
        utils.parseUnits('10000', 6),
      ],
      true,
    );
    let txSwap = await populateTx(keeperMulticall, 'swapToken', [0, payload1Inch.tx.data], true);

    expect(keeperMulticall.connect(deployer).executeActions([txSwap], 0)).to.be.revertedWith(
      'action reverted: Error(ERC20: transfer amount exceeds allowance)',
    );
    await keeperMulticall.connect(deployer).executeActions([txApprove, txSwap], 0);

    payload1Inch = await get1inchSwapData(
      1,
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      keeperMulticall.address,
      utils.parseUnits('1000', 6).toString(),
      10,
    );
    txSwap = await populateTx(keeperMulticall, 'swapToken', [payload1Inch.toTokenAmount, payload1Inch.tx.data], true);
    expect(keeperMulticall.connect(deployer).executeActions([txSwap], 0)).to.be.reverted;
  });

  it('finalBalanceCheck - DAI', async () => {
    await USDC.connect(deployer).transfer(keeperMulticall.address, utils.parseUnits('10000', 6));
    expect(keeperMulticall.finalBalanceCheck([], [])).to.be.reverted;
    expect(keeperMulticall.finalBalanceCheck([USDC.address], [])).to.be.reverted;
    await keeperMulticall.finalBalanceCheck([USDC.address], [10]);

    const payload1Inch = await get1inchSwapData(
      1,
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      '0x6B175474E89094C44Da98b954EedeAC495271d0F',
      keeperMulticall.address,
      utils.parseUnits('1000', 6).toString(),
      10,
    );

    const txApprove = await populateTx(
      keeperMulticall,
      'approve',
      [
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        '0x1111111254fb6c44bAC0beD2854e76F90643097d',
        utils.parseUnits('1000', 6),
      ],
      true,
    );
    const txSwap = await populateTx(keeperMulticall, 'swapToken', [0, payload1Inch.tx.data], true);
    let txCheck = await populateTx(
      keeperMulticall,
      'finalBalanceCheck',
      [['0x6B175474E89094C44Da98b954EedeAC495271d0F'], [utils.parseEther('1000')]],
      true,
    );
    expect(keeperMulticall.connect(deployer).executeActions([txApprove, txSwap, txCheck], 0)).to.be.reverted;

    txCheck = await populateTx(
      keeperMulticall,
      'finalBalanceCheck',
      [['0x6B175474E89094C44Da98b954EedeAC495271d0F'], [utils.parseEther('990')]],
      true,
    );
    await keeperMulticall.connect(deployer).executeActions([txApprove, txSwap, txCheck], 0);
  });

  it('finalBalanceCheck - ETH', async () => {
    await USDC.connect(deployer).transfer(keeperMulticall.address, utils.parseUnits('10000', 6));

    const payload1Inch = await get1inchSwapData(
      1,
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      keeperMulticall.address,
      utils.parseUnits('1000', 6).toString(),
      10,
    );

    const txApprove = await populateTx(
      keeperMulticall,
      'approve',
      [
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        '0x1111111254fb6c44bAC0beD2854e76F90643097d',
        utils.parseUnits('1000', 6),
      ],
      true,
    );
    const txSwap = await populateTx(keeperMulticall, 'swapToken', [0, payload1Inch.tx.data], true);
    let txCheck = await populateTx(
      keeperMulticall,
      'finalBalanceCheck',
      [['0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'], [utils.parseEther('1')]],
      true,
    );
    expect(keeperMulticall.connect(deployer).executeActions([txApprove, txSwap, txCheck], 0)).to.be.reverted;

    txCheck = await populateTx(
      keeperMulticall,
      'finalBalanceCheck',
      [['0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'], [utils.parseEther('0.3')]],
      true,
    );
    await keeperMulticall.connect(deployer).executeActions([txApprove, txSwap, txCheck], 0);
  });
});
