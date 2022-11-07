import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { parseEther } from 'ethers/lib/utils';
import { contract, ethers } from 'hardhat';

import {
  MerkleRewardManagerEthereum,
  MerkleRewardManagerEthereum__factory,
  MockCoreBorrow,
  MockCoreBorrow__factory,
  MockToken,
  MockToken__factory,
  MockUniswapV3Pool,
  MockUniswapV3Pool__factory,
} from '../../../typechain';
import { parseAmount } from '../../../utils/bignumber';
import { expect } from '../utils/chai-setup';
import { inReceipt } from '../utils/expectEvent';
import { deployUpgradeable, latestTime, MAX_UINT256, ZERO_ADDRESS } from '../utils/helpers';

contract('MerkleRewardManager', () => {
  let deployer: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let governor: SignerWithAddress;
  let guardian: SignerWithAddress;
  let angle: MockToken;
  let pool: MockUniswapV3Pool;

  let manager: MerkleRewardManagerEthereum;
  let coreBorrow: MockCoreBorrow;
  let startTime: number;
  // eslint-disable-next-line
  let params: any;

  beforeEach(async () => {
    [deployer, alice, bob, governor, guardian] = await ethers.getSigners();
    angle = (await new MockToken__factory(deployer).deploy('ANGLE', 'ANGLE', 18)) as MockToken;
    coreBorrow = (await new MockCoreBorrow__factory(deployer).deploy()) as MockCoreBorrow;
    pool = (await new MockUniswapV3Pool__factory(deployer).deploy()) as MockUniswapV3Pool;
    await coreBorrow.toggleGuardian(guardian.address);
    await coreBorrow.toggleGovernor(governor.address);
    manager = (await deployUpgradeable(
      new MerkleRewardManagerEthereum__factory(deployer),
    )) as MerkleRewardManagerEthereum;
    await manager.initialize(coreBorrow.address, bob.address, parseAmount.gwei('0.1'));
    startTime = await latestTime();
    params = {
      uniV3Pool: pool.address,
      token: angle.address,
      positionWrappers: [alice.address, bob.address, deployer.address],
      amount: parseEther('1'),
      propToken1: 4000,
      propToken2: 2000,
      propFees: 4000,
      outOfRangeIncentivized: 0,
      epochStart: startTime,
      numEpoch: 1,
      boostedReward: 0,
      boostingAddress: ZERO_ADDRESS,
    };
    await angle.mint(alice.address, parseEther('1000'));
    await angle.connect(alice).approve(manager.address, MAX_UINT256);
  });
  describe('initializer', () => {
    it('success - treasury', async () => {
      expect(await manager.merkleRootDistributor()).to.be.equal(bob.address);
      expect(await manager.coreBorrow()).to.be.equal(coreBorrow.address);
      expect(await manager.fees()).to.be.equal(parseAmount.gwei('0.1'));
    });
    it('reverts - already initialized', async () => {
      await expect(manager.initialize(coreBorrow.address, bob.address, parseAmount.gwei('0.1'))).to.be.revertedWith(
        'Initializable: contract is already initialized',
      );
    });
    it('reverts - zero address', async () => {
      const managerRevert = (await deployUpgradeable(
        new MerkleRewardManagerEthereum__factory(deployer),
      )) as MerkleRewardManagerEthereum;
      await expect(managerRevert.initialize(ZERO_ADDRESS, bob.address, parseAmount.gwei('0.1'))).to.be.revertedWith(
        'ZeroAddress',
      );
      await expect(
        managerRevert.initialize(coreBorrow.address, ZERO_ADDRESS, parseAmount.gwei('0.1')),
      ).to.be.revertedWith('ZeroAddress');
      await expect(
        managerRevert.initialize(coreBorrow.address, bob.address, parseAmount.gwei('1.1')),
      ).to.be.revertedWith('InvalidParam');
    });
  });
  describe('Access Control', () => {
    it('reverts - not governor or guardian', async () => {
      await expect(manager.connect(alice).setNewMerkleRootDistributor(ZERO_ADDRESS)).to.be.revertedWith(
        'NotGovernorOrGuardian',
      );
      await expect(manager.connect(alice).setFees(parseAmount.gwei('0.1'))).to.be.revertedWith('NotGovernorOrGuardian');
      await expect(manager.connect(alice).setUserFeeRebate(ZERO_ADDRESS, parseAmount.gwei('0.1'))).to.be.revertedWith(
        'NotGovernorOrGuardian',
      );
      await expect(manager.connect(alice).recoverFees([], ZERO_ADDRESS)).to.be.revertedWith('NotGovernorOrGuardian');
    });
  });
  describe('setNewMerkleRootDistributor', () => {
    it('reverts - zero address', async () => {
      await expect(manager.connect(guardian).setNewMerkleRootDistributor(ZERO_ADDRESS)).to.be.revertedWith(
        'InvalidParam',
      );
    });
    it('success - value updated', async () => {
      const receipt = await (await manager.connect(guardian).setNewMerkleRootDistributor(alice.address)).wait();
      inReceipt(receipt, 'MerkleRootDistributorUpdated', {
        _merkleRootDistributor: alice.address,
      });
      expect(await manager.merkleRootDistributor()).to.be.equal(alice.address);
    });
  });
  describe('setFees', () => {
    it('reverts - zero address', async () => {
      await expect(manager.connect(guardian).setFees(parseAmount.gwei('1.1'))).to.be.revertedWith('InvalidParam');
    });
    it('success - value updated', async () => {
      const receipt = await (await manager.connect(guardian).setFees(parseAmount.gwei('0.13'))).wait();
      inReceipt(receipt, 'FeesSet', {
        _fees: parseAmount.gwei('0.13'),
      });
      expect(await manager.fees()).to.be.equal(parseAmount.gwei('0.13'));
    });
  });
  describe('setUserFeeRebate', () => {
    it('success - value updated', async () => {
      const receipt = await (
        await manager.connect(guardian).setUserFeeRebate(deployer.address, parseAmount.gwei('0.13'))
      ).wait();
      inReceipt(receipt, 'FeeRebateUpdated', {
        user: deployer.address,
        userFeeRebate: parseAmount.gwei('0.13'),
      });
      expect(await manager.feeRebate(deployer.address)).to.be.equal(parseAmount.gwei('0.13'));
    });
  });
  describe('recoverFees', () => {
    it('success - fees recovered', async () => {
      await manager.connect(guardian).recoverFees([], deployer.address);
      await angle.mint(manager.address, parseAmount.gwei('100'));
      expect(await angle.balanceOf(manager.address)).to.be.equal(parseAmount.gwei('100'));
      await manager.connect(guardian).recoverFees([angle.address], deployer.address);
      expect(await angle.balanceOf(manager.address)).to.be.equal(parseAmount.gwei('0'));
      expect(await angle.balanceOf(deployer.address)).to.be.equal(parseAmount.gwei('100'));
      const usdc = (await new MockToken__factory(deployer).deploy('usdc', 'usdc', 18)) as MockToken;
      await angle.mint(manager.address, parseAmount.gwei('100'));
      await usdc.mint(manager.address, parseAmount.gwei('33'));
      await manager.connect(guardian).recoverFees([angle.address, usdc.address], deployer.address);
      expect(await angle.balanceOf(manager.address)).to.be.equal(parseAmount.gwei('0'));
      // 100 + 100
      expect(await angle.balanceOf(deployer.address)).to.be.equal(parseAmount.gwei('200'));
      expect(await usdc.balanceOf(manager.address)).to.be.equal(parseAmount.gwei('0'));
      expect(await usdc.balanceOf(deployer.address)).to.be.equal(parseAmount.gwei('33'));
    });
  });
  describe('depositReward', () => {
    it('reverts - invalid reward', async () => {
      const param0 = {
        uniV3Pool: pool.address,
        token: angle.address,
        positionWrappers: [alice.address, bob.address, deployer.address],
        amount: parseEther('1'),
        propToken1: 4000,
        propToken2: 2000,
        propFees: 4000,
        outOfRangeIncentivized: 0,
        epochStart: 0,
        numEpoch: 1,
        boostedReward: 0,
        boostingAddress: ZERO_ADDRESS,
      };
      const param1 = {
        uniV3Pool: pool.address,
        token: angle.address,
        positionWrappers: [alice.address, bob.address, deployer.address],
        amount: parseEther('1'),
        propToken1: 4000,
        propToken2: 2000,
        propFees: 4000,
        outOfRangeIncentivized: 0,
        epochStart: startTime,
        numEpoch: 0,
        boostedReward: 0,
        boostingAddress: ZERO_ADDRESS,
      };
      const param2 = {
        uniV3Pool: pool.address,
        token: angle.address,
        positionWrappers: [alice.address, bob.address, deployer.address],
        amount: 0,
        propToken1: 4000,
        propToken2: 2000,
        propFees: 4000,
        outOfRangeIncentivized: 0,
        epochStart: startTime,
        numEpoch: 1,
        boostedReward: 0,
        boostingAddress: ZERO_ADDRESS,
      };
      const param3 = {
        uniV3Pool: pool.address,
        token: angle.address,
        positionWrappers: [alice.address, bob.address, deployer.address],
        amount: parseEther('1'),
        propToken1: 4000,
        propToken2: 2001,
        propFees: 4000,
        outOfRangeIncentivized: 0,
        epochStart: startTime,
        numEpoch: 1,
        boostedReward: 0,
        boostingAddress: ZERO_ADDRESS,
      };
      const param4 = {
        uniV3Pool: pool.address,
        token: angle.address,
        positionWrappers: [alice.address, bob.address, deployer.address],
        amount: parseEther('1'),
        propToken1: 4000,
        propToken2: 2000,
        propFees: 3999,
        outOfRangeIncentivized: 0,
        epochStart: startTime,
        numEpoch: 1,
        boostedReward: 0,
        boostingAddress: ZERO_ADDRESS,
      };
      const param5 = {
        uniV3Pool: pool.address,
        token: angle.address,
        positionWrappers: [alice.address, bob.address, deployer.address],
        amount: parseEther('1'),
        propToken1: 4000,
        propToken2: 2000,
        propFees: 4000,
        outOfRangeIncentivized: 0,
        epochStart: startTime,
        numEpoch: 1,
        boostedReward: 9999,
        boostingAddress: bob.address,
      };
      await expect(manager.connect(alice).depositReward(param0)).to.be.revertedWith('InvalidReward');
      await expect(manager.connect(alice).depositReward(param1)).to.be.revertedWith('InvalidReward');
      await expect(manager.connect(alice).depositReward(param2)).to.be.revertedWith('InvalidReward');
      await expect(manager.connect(alice).depositReward(param3)).to.be.revertedWith('InvalidReward');
      await expect(manager.connect(alice).depositReward(param4)).to.be.revertedWith('InvalidReward');
      await expect(manager.connect(alice).depositReward(param5)).to.be.revertedWith('InvalidReward');
    });
    it('success - when no fee rebate or agEUR pool', async () => {
      await manager.connect(alice).depositReward(params);
      expect(await angle.balanceOf(manager.address)).to.be.equal(parseEther('0.1'));
      expect(await angle.balanceOf(bob.address)).to.be.equal(parseEther('0.9'));
      const reward = await manager.rewardList(0);
      expect(reward.uniV3Pool).to.be.equal(pool.address);
      expect(reward.token).to.be.equal(angle.address);
      expect(reward.amount).to.be.equal(parseEther('0.9'));
      expect(reward.propToken1).to.be.equal(4000);
      expect(reward.propToken2).to.be.equal(2000);
      expect(reward.propFees).to.be.equal(4000);
      expect(reward.outOfRangeIncentivized).to.be.equal(0);
      expect(reward.epochStart).to.be.equal(await pool.round(startTime));
      expect(reward.numEpoch).to.be.equal(1);
      expect(reward.boostedReward).to.be.equal(0);
      expect(reward.boostingAddress).to.be.equal(ZERO_ADDRESS);
    });
    it('success - when a fee rebate for the specific address 1/2', async () => {
      // 50% rebate on fee
      await manager.connect(guardian).setUserFeeRebate(alice.address, parseAmount.gwei('0.5'));
      await manager.connect(alice).depositReward(params);
      expect(await angle.balanceOf(manager.address)).to.be.equal(parseEther('0.05'));
      expect(await angle.balanceOf(bob.address)).to.be.equal(parseEther('0.95'));
      const reward = await manager.rewardList(0);
      expect(reward.uniV3Pool).to.be.equal(pool.address);
      expect(reward.token).to.be.equal(angle.address);
      expect(reward.amount).to.be.equal(parseEther('0.95'));
      expect(reward.propToken1).to.be.equal(4000);
      expect(reward.propToken2).to.be.equal(2000);
      expect(reward.propFees).to.be.equal(4000);
      expect(reward.outOfRangeIncentivized).to.be.equal(0);
      expect(reward.epochStart).to.be.equal(await pool.round(startTime));
      expect(reward.numEpoch).to.be.equal(1);
      expect(reward.boostedReward).to.be.equal(0);
      expect(reward.boostingAddress).to.be.equal(ZERO_ADDRESS);
    });
    it('success - when a fee rebate for the specific address 2/2', async () => {
      // 50% rebate on fee
      await manager.connect(guardian).setUserFeeRebate(alice.address, parseAmount.gwei('1.1'));
      await manager.connect(alice).depositReward(params);
      expect(await angle.balanceOf(manager.address)).to.be.equal(parseEther('0'));
      expect(await angle.balanceOf(bob.address)).to.be.equal(parseEther('1'));
      const reward = await manager.rewardList(0);
      expect(reward.uniV3Pool).to.be.equal(pool.address);
      expect(reward.token).to.be.equal(angle.address);
      expect(reward.amount).to.be.equal(parseEther('1'));
      expect(reward.propToken1).to.be.equal(4000);
      expect(reward.propToken2).to.be.equal(2000);
      expect(reward.propFees).to.be.equal(4000);
      expect(reward.outOfRangeIncentivized).to.be.equal(0);
      expect(reward.epochStart).to.be.equal(await pool.round(startTime));
      expect(reward.numEpoch).to.be.equal(1);
      expect(reward.boostedReward).to.be.equal(0);
      expect(reward.boostingAddress).to.be.equal(ZERO_ADDRESS);
    });
    it('success - when agEUR is a token 1/2', async () => {
      // 50% rebate on fee
      await pool.setToken('0x1a7e4e63778B4f12a199C062f3eFdD288afCBce8', 0);
      await manager.connect(alice).depositReward(params);
      expect(await angle.balanceOf(manager.address)).to.be.equal(parseEther('0'));
      expect(await angle.balanceOf(bob.address)).to.be.equal(parseEther('1'));
      const reward = await manager.rewardList(0);
      expect(reward.uniV3Pool).to.be.equal(pool.address);
      expect(reward.token).to.be.equal(angle.address);
      expect(reward.amount).to.be.equal(parseEther('1'));
      expect(reward.propToken1).to.be.equal(4000);
      expect(reward.propToken2).to.be.equal(2000);
      expect(reward.propFees).to.be.equal(4000);
      expect(reward.outOfRangeIncentivized).to.be.equal(0);
      expect(reward.epochStart).to.be.equal(await pool.round(startTime));
      expect(reward.numEpoch).to.be.equal(1);
      expect(reward.boostedReward).to.be.equal(0);
      expect(reward.boostingAddress).to.be.equal(ZERO_ADDRESS);
    });
    it('success - when agEUR is a token 2/2', async () => {
      // 50% rebate on fee
      await pool.setToken('0x1a7e4e63778B4f12a199C062f3eFdD288afCBce8', 1);
      await manager.connect(alice).depositReward(params);
      expect(await angle.balanceOf(manager.address)).to.be.equal(parseEther('0'));
      expect(await angle.balanceOf(bob.address)).to.be.equal(parseEther('1'));
      const reward = await manager.rewardList(0);
      expect(reward.uniV3Pool).to.be.equal(pool.address);
      expect(reward.token).to.be.equal(angle.address);
      expect(reward.amount).to.be.equal(parseEther('1'));
      expect(reward.propToken1).to.be.equal(4000);
      expect(reward.propToken2).to.be.equal(2000);
      expect(reward.propFees).to.be.equal(4000);
      expect(reward.outOfRangeIncentivized).to.be.equal(0);
      expect(reward.epochStart).to.be.equal(await pool.round(startTime));
      expect(reward.numEpoch).to.be.equal(1);
      expect(reward.boostedReward).to.be.equal(0);
      expect(reward.boostingAddress).to.be.equal(ZERO_ADDRESS);
    });
    it('success - view functions check', async () => {
      // 50% rebate on fee
      await pool.setToken('0x1a7e4e63778B4f12a199C062f3eFdD288afCBce8', 0);
      await manager.connect(alice).depositReward(params);
      const allRewards = await manager.getAllRewards();
      expect(allRewards.length).to.be.equal(1);
      const reward = allRewards[0];
      expect(reward.uniV3Pool).to.be.equal(pool.address);
      expect(reward.token).to.be.equal(angle.address);
      expect(reward.amount).to.be.equal(parseEther('1'));
      expect(reward.propToken1).to.be.equal(4000);
      expect(reward.propToken2).to.be.equal(2000);
      expect(reward.propFees).to.be.equal(4000);
      expect(reward.outOfRangeIncentivized).to.be.equal(0);
      expect(reward.epochStart).to.be.equal(await pool.round(startTime));
      expect(reward.numEpoch).to.be.equal(1);
      expect(reward.boostedReward).to.be.equal(0);
      expect(reward.boostingAddress).to.be.equal(ZERO_ADDRESS);
      expect(allRewards[0].positionWrappers[0]).to.be.equal(alice.address);
      expect(allRewards[0].positionWrappers[1]).to.be.equal(bob.address);
      expect(allRewards[0].positionWrappers[2]).to.be.equal(deployer.address);

      const activeRewards = await manager.getActiveRewards();
      expect(activeRewards.length).to.be.equal(1);
      expect(activeRewards[0].positionWrappers[0]).to.be.equal(alice.address);
      expect(activeRewards[0].positionWrappers[1]).to.be.equal(bob.address);
      expect(activeRewards[0].positionWrappers[2]).to.be.equal(deployer.address);

      const rewardsForEpoch = await manager.getRewardsForEpoch(startTime);
      expect(rewardsForEpoch.length).to.be.equal(1);
      expect(rewardsForEpoch[0].positionWrappers[0]).to.be.equal(alice.address);
      expect(rewardsForEpoch[0].positionWrappers[1]).to.be.equal(bob.address);
      expect(rewardsForEpoch[0].positionWrappers[2]).to.be.equal(deployer.address);
      expect((await manager.getRewardsForEpoch(startTime + 86400 * 7)).length).to.be.equal(0);

      const poolRewards = await manager.getActivePoolRewards(pool.address);
      expect(poolRewards.length).to.be.equal(1);
      expect(poolRewards[0].positionWrappers[0]).to.be.equal(alice.address);
      expect(poolRewards[0].positionWrappers[1]).to.be.equal(bob.address);
      expect(poolRewards[0].positionWrappers[2]).to.be.equal(deployer.address);
      expect((await manager.getActivePoolRewards(bob.address)).length).to.be.equal(0);

      const poolRewardsForEpoch = await manager.getPoolRewardsForEpoch(pool.address, startTime);
      expect(poolRewardsForEpoch.length).to.be.equal(1);
      expect(poolRewardsForEpoch[0].positionWrappers[0]).to.be.equal(alice.address);
      expect(poolRewardsForEpoch[0].positionWrappers[1]).to.be.equal(bob.address);
      expect(poolRewardsForEpoch[0].positionWrappers[2]).to.be.equal(deployer.address);
      expect((await manager.getPoolRewardsForEpoch(pool.address, startTime + 86400 * 7)).length).to.be.equal(0);
    });
    it('success - when spans over several epochs', async () => {
      await pool.setToken('0x1a7e4e63778B4f12a199C062f3eFdD288afCBce8', 0);
      const params2 = {
        uniV3Pool: pool.address,
        token: angle.address,
        positionWrappers: [alice.address, bob.address, deployer.address],
        amount: parseEther('1'),
        propToken1: 4000,
        propToken2: 2000,
        propFees: 4000,
        outOfRangeIncentivized: 0,
        epochStart: startTime,
        numEpoch: 10,

        boostedReward: 0,
        boostingAddress: ZERO_ADDRESS,
      };
      await manager.connect(alice).depositReward(params2);
      const poolRewardsForEpoch = await manager.getPoolRewardsForEpoch(pool.address, startTime);
      expect(poolRewardsForEpoch.length).to.be.equal(1);
      expect(poolRewardsForEpoch[0].positionWrappers[0]).to.be.equal(alice.address);
      expect(poolRewardsForEpoch[0].positionWrappers[1]).to.be.equal(bob.address);
      expect(poolRewardsForEpoch[0].positionWrappers[2]).to.be.equal(deployer.address);
      expect((await manager.getPoolRewardsForEpoch(pool.address, startTime + 86400 * 7)).length).to.be.equal(1);
      expect((await manager.getPoolRewardsForEpoch(pool.address, startTime + 86400 * 7 * 9)).length).to.be.equal(1);
      expect((await manager.getPoolRewardsForEpoch(pool.address, startTime + 86400 * 7 * 10)).length).to.be.equal(0);
      const rewardsForEpoch = await manager.getRewardsForEpoch(startTime);
      expect(rewardsForEpoch.length).to.be.equal(1);
      expect(rewardsForEpoch[0].positionWrappers[0]).to.be.equal(alice.address);
      expect(rewardsForEpoch[0].positionWrappers[1]).to.be.equal(bob.address);
      expect(rewardsForEpoch[0].positionWrappers[2]).to.be.equal(deployer.address);
      expect((await manager.getRewardsForEpoch(startTime + 86400 * 7)).length).to.be.equal(1);
      expect((await manager.getRewardsForEpoch(startTime + 86400 * 7 * 9)).length).to.be.equal(1);
      expect((await manager.getRewardsForEpoch(startTime + 86400 * 7 * 10)).length).to.be.equal(0);
    });
  });
  describe('depositRewards', () => {
    it('success - when multiple rewards over multiple periods and multiple pools', async () => {
      const mockPool = (await new MockUniswapV3Pool__factory(deployer).deploy()) as MockUniswapV3Pool;
      const params0 = {
        uniV3Pool: pool.address,
        token: angle.address,
        positionWrappers: [alice.address, bob.address, deployer.address],
        amount: parseEther('1'),
        propToken1: 4000,
        propToken2: 2000,
        propFees: 4000,
        outOfRangeIncentivized: 0,
        epochStart: startTime,
        numEpoch: 3,

        boostedReward: 0,
        boostingAddress: ZERO_ADDRESS,
      };
      const params1 = {
        uniV3Pool: mockPool.address,
        token: angle.address,
        positionWrappers: [alice.address, bob.address, deployer.address],
        amount: parseEther('2'),
        propToken1: 4000,
        propToken2: 2000,
        propFees: 4000,
        outOfRangeIncentivized: 0,
        epochStart: startTime + 86400 * 7,
        numEpoch: 1,
        boostedReward: 0,
        boostingAddress: ZERO_ADDRESS,
      };
      const params2 = {
        uniV3Pool: pool.address,
        token: angle.address,
        positionWrappers: [alice.address, bob.address, deployer.address],
        amount: parseEther('3'),
        propToken1: 4000,
        propToken2: 2000,
        propFees: 4000,
        outOfRangeIncentivized: 0,
        epochStart: startTime + 86400 * 7 * 2,
        numEpoch: 3,

        boostedReward: 0,
        boostingAddress: ZERO_ADDRESS,
      };
      const params3 = {
        uniV3Pool: mockPool.address,
        token: angle.address,
        positionWrappers: [alice.address, bob.address, deployer.address],
        amount: parseEther('4'),
        propToken1: 4000,
        propToken2: 2000,
        propFees: 4000,
        outOfRangeIncentivized: 0,
        epochStart: startTime + 86400 * 7 * 10,
        numEpoch: 3,
        boostedReward: 0,
        boostingAddress: ZERO_ADDRESS,
      };
      await manager.connect(alice).depositRewards([params0, params1, params2, params3]);
      // 10% of 1+2+3+4
      expect(await angle.balanceOf(manager.address)).to.be.equal(parseEther('1'));
      expect(await angle.balanceOf(bob.address)).to.be.equal(parseEther('9'));
      expect((await manager.rewardList(0)).amount).to.be.equal(parseEther('0.9'));
      expect((await manager.rewardList(1)).amount).to.be.equal(parseEther('1.8'));
      expect((await manager.rewardList(2)).amount).to.be.equal(parseEther('2.7'));
      expect((await manager.rewardList(3)).amount).to.be.equal(parseEther('3.6'));

      expect((await manager.getAllRewards()).length).to.be.equal(4);

      const activeRewards = await manager.getActiveRewards();
      expect(activeRewards.length).to.be.equal(1);
      expect(activeRewards[0].amount).to.be.equal(parseEther('0.9'));

      const activePoolRewards = await manager.getActivePoolRewards(pool.address);
      expect(activePoolRewards.length).to.be.equal(1);
      expect(activePoolRewards[0].amount).to.be.equal(parseEther('0.9'));
      expect(await manager.getActivePoolRewards(mockPool.address));

      const epochRewards0 = await manager.getRewardsForEpoch(startTime + 86400 * 7);
      expect(epochRewards0.length).to.be.equal(2);
      expect(epochRewards0[0].amount).to.be.equal(parseEther('0.9'));
      expect(epochRewards0[1].amount).to.be.equal(parseEther('1.8'));

      const epochRewards1 = await manager.getRewardsForEpoch(startTime + 86400 * 7 * 2);
      expect(epochRewards1.length).to.be.equal(2);
      expect(epochRewards1[0].amount).to.be.equal(parseEther('0.9'));
      expect(epochRewards1[1].amount).to.be.equal(parseEther('2.7'));

      const epochRewards2 = await manager.getRewardsForEpoch(startTime + 86400 * 7 * 3);
      expect(epochRewards2.length).to.be.equal(1);
      expect(epochRewards2[0].amount).to.be.equal(parseEther('2.7'));

      const epochRewards3 = await manager.getRewardsForEpoch(startTime + 86400 * 7 * 10);
      expect(epochRewards3.length).to.be.equal(1);
      expect(epochRewards3[0].amount).to.be.equal(parseEther('3.6'));

      const poolRewards0 = await manager.getPoolRewardsForEpoch(pool.address, startTime + 86400 * 7);
      expect(poolRewards0.length).to.be.equal(1);
      expect(poolRewards0[0].amount).to.be.equal(parseEther('0.9'));

      const poolRewards1 = await manager.getPoolRewardsForEpoch(pool.address, startTime + 86400 * 7 * 2);
      expect(poolRewards1.length).to.be.equal(2);
      expect(poolRewards1[0].amount).to.be.equal(parseEther('0.9'));
      expect(poolRewards1[1].amount).to.be.equal(parseEther('2.7'));

      const poolRewards2 = await manager.getPoolRewardsForEpoch(pool.address, startTime + 86400 * 7 * 3);
      expect(poolRewards2.length).to.be.equal(1);
      expect(poolRewards2[0].amount).to.be.equal(parseEther('2.7'));

      const poolRewards3 = await manager.getPoolRewardsForEpoch(pool.address, startTime + 86400 * 7 * 10);
      expect(poolRewards3.length).to.be.equal(0);

      const poolRewards01 = await manager.getPoolRewardsForEpoch(mockPool.address, startTime + 86400 * 7);
      expect(poolRewards01.length).to.be.equal(1);
      expect(poolRewards01[0].amount).to.be.equal(parseEther('1.8'));

      const poolRewards11 = await manager.getPoolRewardsForEpoch(mockPool.address, startTime + 86400 * 7 * 2);
      expect(poolRewards11.length).to.be.equal(0);

      const poolRewards21 = await manager.getPoolRewardsForEpoch(mockPool.address, startTime + 86400 * 7 * 3);
      expect(poolRewards21.length).to.be.equal(0);

      const poolRewards31 = await manager.getPoolRewardsForEpoch(mockPool.address, startTime + 86400 * 7 * 10);
      expect(poolRewards31.length).to.be.equal(1);
      expect(poolRewards31[0].amount).to.be.equal(parseEther('3.6'));
    });
  });
});
