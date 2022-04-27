import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import axios from 'axios';
import { BigNumber, Contract, utils, Wallet } from 'ethers';
import { ethers, network } from 'hardhat';
import qs from 'qs';

import { expect } from '../../test/utils/chai-setup';
import { IERC20, IERC20__factory, KeeperMulticall, KeeperMulticall__factory } from '../../typechain';

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

describe('Keeper Multicall (mainnet fork)', async () => {
  let deployer: SignerWithAddress, keeper: SignerWithAddress, proxyAdmin: SignerWithAddress;
  let randomUser: string;

  let keeperMulticall: KeeperMulticall;
  let USDC: IERC20;

  beforeEach(async () => {
    await network.provider.request({
      method: 'hardhat_reset',
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.ETH_NODE_URI_FORK,
            // If you change the block, you will need to change 1Inch payloads
            blockNumber: 14659740,
          },
        },
      ],
    });

    [deployer, keeper, proxyAdmin] = await ethers.getSigners();

    const keeperMulticallImplementation = await (await ethers.getContractFactory('KeeperMulticall')).deploy();
    const initializeData = KeeperMulticall__factory.createInterface().encodeFunctionData('initialize', [
      keeper.address,
    ]);
    const proxy = await (
      await ethers.getContractFactory('TransparentUpgradeableProxy')
    ).deploy(keeperMulticallImplementation.address, proxyAdmin.address, initializeData);
    keeperMulticall = new Contract(
      proxy.address,
      [...KeeperMulticall__factory.abi, 'function upgradeTo(address newImplementation) external'],
      deployer,
    ) as KeeperMulticall;

    expect(await keeperMulticall.hasRole(await keeperMulticall.KEEPER_ROLE(), deployer.address)).to.be.false;
    expect(await keeperMulticall.hasRole(await keeperMulticall.KEEPER_ROLE(), keeper.address)).to.be.true;

    // SETUP
    await network.provider.send('hardhat_setStorageAt', [
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      utils.solidityKeccak256(['uint256', 'uint256'], [deployer.address, 9]).replace('0x0', '0x'),
      utils.hexZeroPad(utils.parseUnits((1_000_000).toString(), 6).toHexString(), 32),
    ]);

    USDC = new Contract('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', IERC20__factory.abi) as IERC20;

    randomUser = Wallet.createRandom().address;
  });

  it('Pay Flashbots 1', async () => {
    await USDC.connect(deployer).transfer(keeperMulticall.address, utils.parseUnits('10000', 6));
    // const payload1Inch = await get1inchSwapData(
    //   1,
    //   '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    //   '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    //   keeperMulticall.address,
    //   utils.parseUnits('10000', 6).toString(),
    //   10,
    // );
    const payload1Inch =
      '0xe449022e00000000000000000000000000000000000000000000000000000002540be40000000000000000000000000000000000000000000000000029adfe339ccd81410000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000000120000000000000000000000088e6a0c2ddd26feeb64f039a2c41296fcb3f5640cfee7c08'; // eslint-disable-line

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
    const tx2 = await populateTx(keeperMulticall, 'swapToken', [0, payload1Inch], true);
    const tx3 = await populateTx(keeperMulticall, 'payFlashbots', [utils.parseEther('1')], true);

    expect(await ethers.provider.getBalance(randomUser)).to.equal(0);

    const receipt = await (await keeperMulticall.connect(keeper).executeActions([tx1, tx2, tx3], 0)).wait();

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
      utils.parseEther('2.3'),
      utils.parseEther('0.1'),
    );
    expect(await USDC.connect(deployer).balanceOf(keeperMulticall.address)).to.equal(0);
  });

  it('Pay Flashbots 2', async () => {
    await USDC.connect(deployer).transfer(keeperMulticall.address, utils.parseUnits('10000', 6));
    // const payload1Inch = await get1inchSwapData(
    //   1,
    //   '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    //   '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    //   keeperMulticall.address,
    //   utils.parseUnits('10000', 6).toString(),
    //   10,
    // );
    const payload1Inch = {
      data: '0xe449022e00000000000000000000000000000000000000000000000000000002540be40000000000000000000000000000000000000000000000000029ae27ddb75a2ac00000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000000120000000000000000000000088e6a0c2ddd26feeb64f039a2c41296fcb3f5640cfee7c08', // eslint-disable-line
      toTokenAmount: '3337090927466772125',
    };

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
    const tx2 = await populateTx(keeperMulticall, 'swapToken', [0, payload1Inch.data], true);

    expect(await ethers.provider.getBalance(keeperMulticall.address)).to.equal(0);

    const receipt = await (await keeperMulticall.connect(keeper).executeActions([tx1, tx2], 1000)).wait();

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
    // const payload1Inch = await get1inchSwapData(
    //   1,
    //   '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    //   '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    //   keeperMulticall.address,
    //   utils.parseUnits('10000', 6).toString(),
    //   10,
    // );

    const payload1Inch = {
      data: '0xe449022e00000000000000000000000000000000000000000000000000000002540be40000000000000000000000000000000000000000000000000029aeb2e294b5da4e0000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000000120000000000000000000000088e6a0c2ddd26feeb64f039a2c41296fcb3f5640cfee7c08', // eslint-disable-line
      toTokenAmount: '3337260764144442683',
    };

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
    const tx2 = await populateTx(keeperMulticall, 'swapToken', [0, payload1Inch.data], true);

    const receipt = await (await keeperMulticall.connect(keeper).executeActions([tx1, tx2], 625)).wait();

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
    // let payload1Inch = await get1inchSwapData(
    //   1,
    //   '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    //   '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    //   keeperMulticall.address,
    //   utils.parseUnits('1000', 6).toString(),
    //   10,
    // );

    let payload1Inch = {
      data: '0xe449022e000000000000000000000000000000000000000000000000000000003b9aca00000000000000000000000000000000000000000000000000042b56aa1bc38f470000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000000120000000000000000000000088e6a0c2ddd26feeb64f039a2c41296fcb3f5640cfee7c08', // eslint-disable-line
      toTokenAmount: '333810098622777822',
    };

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
    let txSwap = await populateTx(keeperMulticall, 'swapToken', [0, payload1Inch.data], true);

    expect(keeperMulticall.connect(keeper).executeActions([txSwap], 0)).to.be.revertedWith(
      'action reverted: Error(ERC20: transfer amount exceeds allowance)',
    );
    await keeperMulticall.connect(keeper).executeActions([txApprove, txSwap], 0);

    // payload1Inch = await get1inchSwapData(
    //   1,
    //   '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    //   '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    //   keeperMulticall.address,
    //   utils.parseUnits('1000', 6).toString(),
    //   10,
    // );
    payload1Inch = {
      data: '0xe449022e000000000000000000000000000000000000000000000000000000003b9aca00000000000000000000000000000000000000000000000000042bd1f9df06636a0000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000000120000000000000000000000088e6a0c2ddd26feeb64f039a2c41296fcb3f5640cfee7c08', // eslint-disable-line
      toTokenAmount: '333960745854521861',
    };
    txSwap = await populateTx(keeperMulticall, 'swapToken', [payload1Inch.toTokenAmount, payload1Inch.data], true);
    expect(keeperMulticall.connect(keeper).executeActions([txSwap], 0)).to.be.reverted;
  });
});
