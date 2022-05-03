import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { SolcInput, SolcOutput, UpgradeableContract } from '@openzeppelin/upgrades-core';
import { Contract, utils, Wallet } from 'ethers';
import { artifacts, ethers, network } from 'hardhat';

import { KeeperMulticall, KeeperMulticall__factory, MockToken, TransparentUpgradeableProxy } from '../../typechain';
import { expect } from '../utils/chai-setup';

async function populateTx(
  contract: Contract,
  functionName: string,
  args?: unknown[],
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

describe('Keeper Multicall', async () => {
  let deployer: SignerWithAddress,
    user1: SignerWithAddress,
    user2: SignerWithAddress,
    keeper: SignerWithAddress,
    proxyAdmin: SignerWithAddress;
  let randomUser: string;

  let keeperMulticall: KeeperMulticall;
  let Token1: MockToken;
  let Token2: MockToken;

  beforeEach(async () => {
    [deployer, user1, user2, keeper, proxyAdmin] = await ethers.getSigners();

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

    Token1 = (await (await ethers.getContractFactory('MockToken')).deploy('Token1', 'TOK1', 18)) as MockToken;
    await Token1.connect(deployer).mint(deployer.address, utils.parseEther('1000'));
    Token2 = (await (await ethers.getContractFactory('MockToken')).deploy('TokenZ', 'TOKZ', 18)) as MockToken;
    await Token2.connect(deployer).mint(deployer.address, utils.parseEther('1000'));

    randomUser = Wallet.createRandom().address;
  });

  it('AccessControl', async () => {
    await Token1.connect(deployer).transfer(keeperMulticall.address, utils.parseUnits('10000', 6));
    const tx = await populateTx(Token1, 'transfer', [user2.address, 10]);
    await expect(keeperMulticall.connect(user1).executeActions([tx], 0)).to.be.revertedWith(
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

    const newImplementation = await (await ethers.getContractFactory('MockKeeperMulticall')).deploy();
    await expect(
      (keeperMulticall as unknown as TransparentUpgradeableProxy).connect(user1).upgradeTo(newImplementation.address),
    ).to.be.reverted;
    await (keeperMulticall as unknown as TransparentUpgradeableProxy)
      .connect(proxyAdmin)
      .upgradeTo(newImplementation.address);

    expect(await ethers.provider.getBalance(keeperMulticall.address)).to.equal(balanceBefore);
  });

  it('Upgrade OZ - success', async () => {
    const buildInfo = await artifacts.getBuildInfo('contracts/keeperMulticall/KeeperMulticall.sol:KeeperMulticall');
    const baseContract = new UpgradeableContract(
      'KeeperMulticall',
      buildInfo?.input as SolcInput,
      buildInfo?.output as SolcOutput,
    );

    const upgradeBuildInfo = await artifacts.getBuildInfo('contracts/mock/MockKeeperMulticall.sol:MockKeeperMulticall');
    const upgradeContract = new UpgradeableContract(
      'MockKeeperMulticall',
      upgradeBuildInfo?.input as SolcInput,
      upgradeBuildInfo?.output as SolcOutput,
    );
    expect(baseContract.getStorageUpgradeReport(upgradeContract).ok).to.be.true;
  });

  it('Upgrade OZ - fail', async () => {
    const buildInfo = await artifacts.getBuildInfo('contracts/keeperMulticall/KeeperMulticall.sol:KeeperMulticall');
    const baseContract = new UpgradeableContract(
      'KeeperMulticall',
      buildInfo?.input as SolcInput,
      buildInfo?.output as SolcOutput,
    );

    const upgradeBuildInfo = await artifacts.getBuildInfo(
      'contracts/mock/MockKeeperMulticall2.sol:MockKeeperMulticall2',
    );
    const upgradeContract = new UpgradeableContract(
      'MockKeeperMulticall2',
      upgradeBuildInfo?.input as SolcInput,
      upgradeBuildInfo?.output as SolcOutput,
    );
    expect(baseContract.getStorageUpgradeReport(upgradeContract).ok).to.be.false;
  });

  it('Array of tasks cannot be empty', async () => {
    await expect(keeperMulticall.connect(keeper).executeActions([], 0)).to.be.reverted;
  });

  it('Roles', async () => {
    const KEEPER_ROLE = await keeperMulticall.KEEPER_ROLE();

    expect(await keeperMulticall.hasRole(KEEPER_ROLE, deployer.address)).to.be.false;
    expect(await keeperMulticall.hasRole(KEEPER_ROLE, keeper.address)).to.be.true;
    expect(await keeperMulticall.hasRole(KEEPER_ROLE, user1.address)).to.be.false;
    expect(await keeperMulticall.hasRole(KEEPER_ROLE, randomUser)).to.be.false;
    await expect(keeperMulticall.connect(deployer).grantRole(KEEPER_ROLE, user1.address)).to.be.reverted;
    await keeperMulticall.connect(keeper).grantRole(KEEPER_ROLE, user1.address);
    expect(await keeperMulticall.hasRole(KEEPER_ROLE, user1.address)).to.be.true;

    await Token1.connect(deployer).transfer(keeperMulticall.address, utils.parseEther('100'));
    const tx1 = await populateTx(Token1, 'transfer', [user2.address, utils.parseEther('2')]);
    expect(await Token1.balanceOf(user2.address)).to.equal(0);

    await expect(keeperMulticall.connect(user2).executeActions([tx1], 0)).to.be.revertedWith(
      `AccessControl: account ${user2.address.toLowerCase()} is missing role ${KEEPER_ROLE.toLowerCase()}`,
    );

    await keeperMulticall.connect(user1).executeActions([tx1], 0);
    expect(await Token1.balanceOf(user2.address)).to.equal(utils.parseEther('2'));
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

    await expect(
      keeperMulticall
        .connect(keeper)
        .withdrawStuckFunds(Token1.address, ethers.constants.AddressZero, utils.parseUnits('1000', 6)),
    ).to.be.revertedWith('ZeroAddress');
    await keeperMulticall.connect(keeper).withdrawStuckFunds(Token1.address, randomUser, utils.parseUnits('1000', 6));
    await keeperMulticall
      .connect(keeper)
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

    await expect(
      Token2.connect(deployer).transferFrom(keeperMulticall.address, randomUser, utils.parseEther('10')),
    ).to.be.revertedWith('ERC20: transfer amount exceeds allowance');

    const tx1 = await populateTx(Token1, 'transfer', [user2.address, utils.parseEther('2')]);
    const tx2 = await populateTx(Token2, 'approve', [deployer.address, utils.parseEther('20')]);
    const tx3 = await populateTx(Token2, 'transfer', [randomUser, utils.parseEther('1')]);
    await (await keeperMulticall.connect(keeper).executeActions([tx1, tx2, tx3], 0)).wait();

    await Token2.connect(deployer).transferFrom(keeperMulticall.address, randomUser, utils.parseEther('12'));
    expect(await Token2.balanceOf(keeperMulticall.address)).to.equal(utils.parseEther('87'));
    expect(await Token2.balanceOf(randomUser)).to.equal(utils.parseEther('13'));

    expect(await Token1.connect(deployer).balanceOf(keeperMulticall.address)).to.equal(utils.parseEther('98'));
    expect(await Token1.connect(deployer).balanceOf(user2.address)).to.equal(utils.parseEther('2'));
  });

  it('finalBalanceCheck - DAI', async () => {
    await Token1.connect(deployer).transfer(keeperMulticall.address, utils.parseEther('100'));
    await expect(keeperMulticall.finalBalanceCheck([], [])).to.be.reverted;
    await expect(keeperMulticall.finalBalanceCheck([Token1.address], [])).to.be.reverted;
    await keeperMulticall.finalBalanceCheck([Token1.address], [10]);

    const txFail = await populateTx(
      keeperMulticall,
      'finalBalanceCheck',
      [[Token1.address], [utils.parseEther('101')]],
      true,
    );

    await expect(keeperMulticall.connect(keeper).executeActions([txFail], 0)).to.be.reverted;

    const txCheck = await populateTx(
      keeperMulticall,
      'finalBalanceCheck',
      [[Token1.address], [utils.parseEther('99')]],
      true,
    );
    await keeperMulticall.connect(keeper).executeActions([txCheck], 0);
  });

  it('Pay miner', async () => {
    const mockSwapper1Inch = await (await ethers.getContractFactory('Mock1Inch')).deploy();
    const bribe = utils.parseEther('5');
    await user1.sendTransaction({
      to: mockSwapper1Inch.address,
      value: bribe,
    });

    await Token1.connect(deployer).transfer(keeperMulticall.address, utils.parseEther('100'));
    const tx1 = await populateTx(Token1, 'transfer', [user2.address, utils.parseEther('2')]);
    const tx2 = await populateTx(Token1, 'approve', [mockSwapper1Inch.address, utils.parseEther('2000')]);

    const tx3 = await populateTx(mockSwapper1Inch, 'swap', [
      Token1.address,
      utils.parseEther('50'),
      randomUser,
      '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      bribe,
    ]);
    const receipt = await (await keeperMulticall.connect(keeper).executeActions([tx1, tx2, tx3], 1000)).wait();

    const miner = (await ethers.provider.getBlock(receipt.blockHash)).miner;
    const balanceBefore = await ethers.provider.getBalance(miner, receipt.blockNumber - 1);
    const currentBalance = await ethers.provider.getBalance(miner, receipt.blockNumber);

    expect(currentBalance.sub(balanceBefore).sub(utils.parseEther('2'))).to.be.closeTo(
      utils.parseEther('0.5'),
      utils.parseEther('0.01'),
    );
    expect(await ethers.provider.getBalance(keeperMulticall.address)).to.equal(utils.parseEther('4.5'));
  });

  it('Pay miner - revert', async () => {
    const mockSwapper1Inch = await (await ethers.getContractFactory('Mock1Inch')).deploy();
    const bribe = utils.parseEther('5');
    await user1.sendTransaction({
      to: mockSwapper1Inch.address,
      value: bribe,
    });

    await Token1.connect(deployer).transfer(keeperMulticall.address, utils.parseEther('100'));
    const tx1 = await populateTx(Token1, 'transfer', [user2.address, utils.parseEther('2')]);

    await expect(keeperMulticall.connect(keeper).executeActions([tx1], 11000)).to.be.revertedWith('WrongAmount()');
  });

  it('Pay miner - balance at end lower than start', async () => {
    await user1.sendTransaction({
      to: keeperMulticall.address,
      value: utils.parseEther('5'),
    });
    const tx = await populateTx(keeperMulticall, 'payFlashbots', [utils.parseEther('0.123')], true);
    await keeperMulticall.connect(keeper).executeActions([tx], 5000);
    expect(await ethers.provider.getBalance(keeperMulticall.address)).to.equal(utils.parseEther('4.877'));
  });

  it('Pay miner', async () => {
    const mockSwapper1Inch = await (await ethers.getContractFactory('Mock1Inch')).deploy();
    const bribe = utils.parseEther('5');
    await user1.sendTransaction({
      to: mockSwapper1Inch.address,
      value: bribe,
    });

    await Token1.connect(deployer).transfer(keeperMulticall.address, utils.parseEther('100'));
    const tx1 = await populateTx(Token1, 'transfer', [user2.address, utils.parseEther('2')]);
    const tx2 = await populateTx(Token1, 'approve', [mockSwapper1Inch.address, utils.parseEther('2000')]);

    const tx3 = await populateTx(mockSwapper1Inch, 'swap', [
      Token1.address,
      utils.parseEther('50'),
      randomUser,
      '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      bribe,
    ]);
    const tx4 = await populateTx(keeperMulticall, 'payFlashbots', [utils.parseEther('5')], true);

    expect(await ethers.provider.getBalance(keeperMulticall.address)).to.equal(0);
    await keeperMulticall.connect(keeper).executeActions([tx1, tx2, tx3, tx4], 1000);
    expect(await ethers.provider.getBalance(keeperMulticall.address)).to.equal(0);
  });

  it('payFlashbots - revert', async () => {
    await user1.sendTransaction({
      to: keeperMulticall.address,
      value: utils.parseEther('5'),
    });

    const tx = await populateTx(keeperMulticall, 'payFlashbots', [utils.parseEther('6')], true);
    // this reverts with error `FlashbotsErrorPayingMiner(uint256 value)`
    await expect(keeperMulticall.connect(keeper).executeActions([tx], 1000)).to.be.revertedWith(
      '0xc3c57d1d00000000000000000000000000000000000000000000000053444835ec580000',
    );
  });

  it('payFlashbots - success', async () => {
    const mockSwapper1Inch = await (await ethers.getContractFactory('Mock1Inch')).deploy();
    await user1.sendTransaction({
      to: mockSwapper1Inch.address,
      value: utils.parseEther('10'),
    });
    await Token1.connect(deployer).transfer(keeperMulticall.address, utils.parseEther('100'));

    const tx1 = await populateTx(Token1, 'approve', [mockSwapper1Inch.address, utils.parseEther('2000')]);
    const tx2 = await populateTx(mockSwapper1Inch, 'swap', [
      Token1.address,
      utils.parseEther('50'),
      randomUser,
      '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      utils.parseEther('2'),
    ]);
    const tx3 = await populateTx(keeperMulticall, 'payFlashbots', [utils.parseEther('0.123')], true);
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

    expect(log?.args.value).to.equal(utils.parseEther('0.123'));

    // the block reward is around 2ETH, so we subtract it
    expect(currentBalance.sub(balanceBefore).sub(utils.parseEther('2'))).to.be.closeTo(
      log?.args.value,
      utils.parseEther('0.01'),
    );

    expect(await ethers.provider.getBalance(keeperMulticall.address)).to.equal(utils.parseEther('1.877'));
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
    await expect(keeperMulticall.connect(keeper).executeActions([txFail], 0)).to.be.reverted;

    const txCheck = await populateTx(
      keeperMulticall,
      'finalBalanceCheck',
      [['0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'], [utils.parseEther('99')]],
      true,
    );
    await keeperMulticall.connect(keeper).executeActions([txCheck], 0);
  });

  it('approve - fail not keeper', async () => {
    await expect(keeperMulticall.approve(Token1.address, randomUser, utils.parseEther('100'))).to.be.revertedWith(
      `AccessControl: account ${deployer.address.toLowerCase()} is missing role ${(
        await keeperMulticall.KEEPER_ROLE()
      ).toLowerCase()}`,
    );
  });

  it('approve - increase allowance', async () => {
    const allowance = utils.parseEther('100');
    await keeperMulticall.connect(keeper).approve(Token1.address, user1.address, allowance);
    expect(await Token1.allowance(keeperMulticall.address, user1.address)).to.equal(allowance);
  });

  it('approve - decrease allowance', async () => {
    const allowance = utils.parseEther('80');
    await keeperMulticall.connect(keeper).approve(Token1.address, user1.address, allowance);
    expect(await Token1.allowance(keeperMulticall.address, user1.address)).to.equal(allowance);

    await Token1.connect(deployer).transfer(keeperMulticall.address, utils.parseEther('100'));
    expect(await Token1.balanceOf(randomUser)).to.equal(0);
    await expect(
      Token1.connect(user1).transferFrom(keeperMulticall.address, randomUser, utils.parseEther('85')),
    ).to.be.revertedWith('ERC20: transfer amount exceeds allowance');
    await Token1.connect(user1).transferFrom(keeperMulticall.address, randomUser, utils.parseEther('60'));
    expect(await Token1.balanceOf(randomUser)).to.equal(utils.parseEther('60'));

    expect(await Token1.allowance(keeperMulticall.address, user1.address)).to.equal(utils.parseEther('20'));

    const newAllowance = utils.parseEther('30');
    await keeperMulticall.connect(keeper).approve(Token1.address, user1.address, newAllowance);
    expect(await Token1.allowance(keeperMulticall.address, user1.address)).to.equal(newAllowance);
  });

  it('swapToken - revert not keeper', async () => {
    await expect(keeperMulticall.swapToken(utils.parseEther('100'), '0x')).to.be.revertedWith(
      `AccessControl: account ${deployer.address.toLowerCase()} is missing role ${(
        await keeperMulticall.KEEPER_ROLE()
      ).toLowerCase()}`,
    );
  });
});
