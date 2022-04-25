import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { Contract, utils, Wallet } from 'ethers';
import { ethers, network } from 'hardhat';

import {
  IERC20,
  KeeperMulticall,
  KeeperMulticall__factory,
  MockToken,
  TransparentUpgradeableProxy,
} from '../../typechain';
import { expect } from '../utils/chai-setup';

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
  let Token1: MockToken;
  let Token2: MockToken;

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

    Token1 = (await (await ethers.getContractFactory('MockToken')).deploy('Token1', 'TOK1', 18)) as MockToken;
    await Token1.connect(deployer).mint(deployer.address, utils.parseEther('1000'));
    Token2 = (await (await ethers.getContractFactory('MockToken')).deploy('TokenZ', 'TOKZ', 18)) as MockToken;
    await Token2.connect(deployer).mint(deployer.address, utils.parseEther('1000'));

    randomUser = Wallet.createRandom().address;
  });

  it('AccessControl', async () => {
    await Token1.connect(deployer).transfer(keeperMulticall.address, utils.parseUnits('10000', 6));
    const tx = await populateTx(Token1, 'transfer', [user2.address, 10]);
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
    expect(keeperMulticall.connect(deployer).executeActions([], 0)).to.be.reverted;
  });

  it('withdrawStuckFunds', async () => {
    await expect(
      keeperMulticall.connect(user1).withdrawStuckFunds(Token1.address, randomUser, utils.parseUnits('1000', 6)),
    ).to.be.revertedWith(
      `AccessControl: account ${user1.address.toLowerCase()} is missing role ${await (
        await keeperMulticall.KEEPER_ROLE()
      ).toLowerCase()}`,
    );

    await Token1.connect(deployer).transfer(keeperMulticall.address, utils.parseUnits('1000', 6));
    await deployer.sendTransaction({
      value: utils.parseEther('10'),
      to: keeperMulticall.address,
    });

    expect(await ethers.provider.getBalance(keeperMulticall.address)).to.equal(utils.parseEther('10'));
    expect(await Token1.connect(deployer).balanceOf(keeperMulticall.address)).to.equal(utils.parseUnits('1000', 6));

    expect(await ethers.provider.getBalance(randomUser)).to.equal(0);
    expect(await Token1.connect(deployer).balanceOf(randomUser)).to.equal(0);

    await keeperMulticall.connect(deployer).withdrawStuckFunds(Token1.address, randomUser, utils.parseUnits('1000', 6));
    await keeperMulticall
      .connect(deployer)
      .withdrawStuckFunds('0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', randomUser, utils.parseEther('10'));
    expect(await ethers.provider.getBalance(randomUser)).to.equal(utils.parseEther('10'));
    expect(await Token1.connect(deployer).balanceOf(randomUser)).to.equal(utils.parseUnits('1000', 6));
  });

  it('Chain multiple random txs', async () => {
    await Token1.connect(deployer).transfer(keeperMulticall.address, utils.parseEther('100'));
    await Token2.connect(deployer).transfer(keeperMulticall.address, utils.parseEther('100'));

    expect(await ethers.provider.getBalance(keeperMulticall.address)).to.equal(0);

    expect(await Token1.connect(deployer).balanceOf(keeperMulticall.address)).to.equal(utils.parseEther('100'));
    expect(await Token1.connect(deployer).balanceOf(user2.address)).to.equal(0);

    expect(
      Token2.connect(deployer).transferFrom(keeperMulticall.address, randomUser, utils.parseEther('10')),
    ).to.be.revertedWith('ERC20: transfer amount exceeds allowance');

    const tx1 = await populateTx(Token1, 'transfer', [user2.address, utils.parseEther('2')]);
    const tx2 = await populateTx(Token2, 'approve', [deployer.address, utils.parseEther('20')]);
    const tx3 = await populateTx(Token2, 'transfer', [randomUser, utils.parseEther('1')]);
    await (await keeperMulticall.connect(deployer).executeActions([tx1, tx2, tx3], 0)).wait();

    await Token2.connect(deployer).transferFrom(keeperMulticall.address, randomUser, utils.parseEther('12'));
    expect(await Token2.balanceOf(keeperMulticall.address)).to.equal(utils.parseEther('87'));
    expect(await Token2.balanceOf(randomUser)).to.equal(utils.parseEther('13'));

    expect(await Token1.connect(deployer).balanceOf(keeperMulticall.address)).to.equal(utils.parseEther('98'));
    expect(await Token1.connect(deployer).balanceOf(user2.address)).to.equal(utils.parseEther('2'));
  });

  it('finalBalanceCheck - DAI', async () => {
    await Token1.connect(deployer).transfer(keeperMulticall.address, utils.parseEther('100'));
    expect(keeperMulticall.finalBalanceCheck([], [])).to.be.reverted;
    expect(keeperMulticall.finalBalanceCheck([Token1.address], [])).to.be.reverted;
    await keeperMulticall.finalBalanceCheck([Token1.address], [10]);

    const txFail = await populateTx(
      keeperMulticall,
      'finalBalanceCheck',
      [[Token1.address], [utils.parseEther('101')]],
      true,
    );

    expect(keeperMulticall.connect(deployer).executeActions([txFail], 0)).to.be.reverted;

    const txCheck = await populateTx(
      keeperMulticall,
      'finalBalanceCheck',
      [[Token1.address], [utils.parseEther('99')]],
      true,
    );
    await keeperMulticall.connect(deployer).executeActions([txCheck], 0);
  });

  it('finalBalanceCheck - ETH', async () => {
    await deployer.sendTransaction({
      to: keeperMulticall.address,
      value: utils.parseEther('100'),
    });

    const txFail = await populateTx(
      keeperMulticall,
      'finalBalanceCheck',
      [['0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'], [utils.parseEther('101')]],
      true,
    );
    expect(keeperMulticall.connect(deployer).executeActions([txFail], 0)).to.be.reverted;

    const txCheck = await populateTx(
      keeperMulticall,
      'finalBalanceCheck',
      [['0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'], [utils.parseEther('99')]],
      true,
    );
    await keeperMulticall.connect(deployer).executeActions([txCheck], 0);
  });
});
