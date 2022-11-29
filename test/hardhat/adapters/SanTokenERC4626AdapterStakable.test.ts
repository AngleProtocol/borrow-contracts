import { ChainId, registry } from '@angleprotocol/sdk';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { Signer } from 'ethers';
import { parseEther, parseUnits } from 'ethers/lib/utils';
import hre, { contract, ethers } from 'hardhat';

import {
  MockTokenPermit,
  MockTokenPermit__factory,
  SanUSDCEURERC4626AdapterStakable,
  SanUSDCEURERC4626AdapterStakable__factory,
} from '../../../typechain';
import { expect } from '../utils/chai-setup';
import { deployUpgradeable, expectApprox, MAX_UINT256, ZERO_ADDRESS } from '../utils/helpers';

contract('SanTokenERC4626AdapterStakable', () => {
  let deployer: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  let adapter: SanUSDCEURERC4626AdapterStakable;
  let usdc: MockTokenPermit;
  let stableMaster: string;
  let poolManager: string;
  let sanRateAtBlock: string;
  let gauge: string;
  let assets: string;
  let sanToken: MockTokenPermit;
  let usdcHolder: string;
  let governor: string;
  let angle: string;
  let angleToken: MockTokenPermit;

  const impersonatedSigners: { [key: string]: Signer } = {};

  before(async () => {
    [deployer, alice, bob] = await ethers.getSigners();

    const collateral = registry(ChainId.MAINNET)?.agEUR?.collaterals?.USDC;
    poolManager = collateral?.PoolManager as string;
    stableMaster = registry(ChainId.MAINNET)?.agEUR?.StableMaster as string;
    const sanTokenAddress = collateral?.SanToken as string;
    sanToken = (await ethers.getContractAt(MockTokenPermit__factory.abi, sanTokenAddress)) as MockTokenPermit;
    usdc = (await ethers.getContractAt(
      MockTokenPermit__factory.abi,
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    )) as MockTokenPermit;
    sanRateAtBlock = '1143918107079882679';
    gauge = '0x51fE22abAF4a26631b2913E417c0560D547797a7';
    assets = '2101885141874';
    usdcHolder = '0x4943b0c9959dcf58871a799dfb71bece0d97c9f4';
    governor = '0xdC4e6DFe07EFCa50a197DF15D9200883eF4Eb1c8';
    angle = '0x31429d1856aD1377A8A0079410B297e1a9e214c2';
    angleToken = (await ethers.getContractAt(MockTokenPermit__factory.abi, angle)) as MockTokenPermit;
  });

  beforeEach(async () => {
    await hre.network.provider.request({
      method: 'hardhat_reset',
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.ETH_NODE_URI_MAINNET,

            blockNumber: 16033678,
          },
        },
      ],
    });
    adapter = (await deployUpgradeable(
      new SanUSDCEURERC4626AdapterStakable__factory(deployer),
    )) as SanUSDCEURERC4626AdapterStakable;
    await adapter.initialize();
    const impersonatedAddresses = [usdcHolder, governor];
    for (const address of impersonatedAddresses) {
      await hre.network.provider.request({
        method: 'hardhat_impersonateAccount',
        params: [address],
      });
      await hre.network.provider.send('hardhat_setBalance', [address, '0x10000000000000000000000000000']);
      impersonatedSigners[address] = await ethers.getSigner(address);
    }
  });
  describe('initializer', () => {
    it('success - stableMaster, name, symbol', async () => {
      expect(await adapter.gauge()).to.be.equal(gauge);
      expect(await sanToken.allowance(adapter.address, gauge)).to.be.equal(MAX_UINT256);
      expect(await adapter.poolManager()).to.be.equal(poolManager);
      expect(await adapter.stableMaster()).to.be.equal(stableMaster);
      expect(await adapter.sanToken()).to.be.equal(sanToken.address);
      expect(await adapter.stableMaster()).to.be.equal(stableMaster);
    });
  });
  describe('deposit', () => {
    it('success - from usdc holder', async () => {
      const gaugeBalance = await sanToken.balanceOf(gauge);
      await usdc.connect(impersonatedSigners[usdcHolder]).approve(adapter.address, MAX_UINT256);
      await adapter.connect(impersonatedSigners[usdcHolder]).deposit(parseUnits('1', 6), alice.address);
      const amount = parseUnits('1', 6).mul(parseEther('1')).div(sanRateAtBlock);
      expect(await sanToken.balanceOf(adapter.address)).to.be.equal(0);
      expect(await adapter.balanceOf(alice.address)).to.be.equal(amount);
      expect(await sanToken.balanceOf(gauge)).to.be.equal(gaugeBalance.add(amount));
      expect(await adapter.availableBalance()).to.be.equal(parseUnits('1', 6).add(assets));
      expectApprox(await adapter.totalAssets(), parseUnits('1', 6), 0.1);

      await adapter.connect(impersonatedSigners[usdcHolder]).deposit(parseUnits('1', 6), alice.address);
      const integral = await adapter.integral(angle);
      expect(integral).to.be.gt(0);
      expect(await angleToken.balanceOf(alice.address)).to.be.equal(0);
      expect(await adapter.integralOf(angle, alice.address)).to.be.equal(integral);
      expect(await adapter.pendingRewardsOf(angle, alice.address)).to.be.equal(
        amount.mul(integral).div(parseUnits('1', 9)),
      );
      // Now if transferring the assets
      await adapter.connect(alice).transfer(bob.address, amount.div(2));
      // This should lead to some claim to be done
      expect(await angleToken.balanceOf(alice.address)).to.be.gt(0);
      const integral2 = await adapter.integral(angle);
      expect(await adapter.integralOf(angle, alice.address)).to.be.equal(integral2);
      expect(await adapter.integralOf(angle, bob.address)).to.be.equal(integral2);
      expect(await adapter.pendingRewardsOf(angle, alice.address)).to.be.equal(0);
      expect(await adapter.pendingRewardsOf(angle, bob.address)).to.be.equal(0);
    });
  });
  describe('claim_rewards', () => {
    it('success - yields non null rewards', async () => {
      await adapter.claim_rewards(ZERO_ADDRESS);
      await adapter.claim_rewards(bob.address);
      await adapter.claim_rewards(alice.address);
      // Now when rewards are sent
      await usdc.connect(impersonatedSigners[usdcHolder]).approve(adapter.address, MAX_UINT256);
      await adapter.connect(impersonatedSigners[usdcHolder]).mint(parseUnits('1', 6), alice.address);
      expect(await adapter.claimableRewards(alice.address, angle)).to.be.equal(0);
      await adapter.claim_rewards(alice.address);
      const integral = await adapter.integral(angle);
      expect(integral).to.be.gt(0);
      expect(await angleToken.balanceOf(alice.address)).to.be.gt(0);
      expect(await adapter.pendingRewardsOf(angle, alice.address)).to.be.equal(0);
      expect(await adapter.integralOf(angle, alice.address)).to.be.equal(integral);
      expect(await adapter.claimableRewards(alice.address, angle)).to.be.equal(0);
      await adapter.connect(alice).redeem(parseUnits('1', 6), alice.address, alice.address);
      expect(await adapter.claimableRewards(alice.address, angle)).to.be.equal(0);
    });
  });
  describe('withdraw', () => {
    it('success - rewards are claimed and amount withdrawn from the gauge', async () => {
      await usdc.connect(impersonatedSigners[usdcHolder]).approve(adapter.address, MAX_UINT256);
      await adapter.connect(impersonatedSigners[usdcHolder]).mint(parseUnits('0.5', 6), alice.address);
      await adapter.connect(impersonatedSigners[usdcHolder]).mint(parseUnits('0.5', 6), alice.address);
      expect(await adapter.claimableRewards(alice.address, angle)).to.be.gt(0);
      const gaugeContract = (await ethers.getContractAt(MockTokenPermit__factory.abi, gauge)) as MockTokenPermit;
      expect(await gaugeContract.balanceOf(adapter.address)).to.be.equal(parseUnits('1', 6));
      await adapter.connect(alice).redeem(parseUnits('0.3', 6), alice.address, alice.address);
      expect(await angleToken.balanceOf(alice.address)).to.be.gt(0);
      const integral = await adapter.integral(angle);
      expect(integral).to.be.gt(0);
      expect(await adapter.pendingRewardsOf(angle, alice.address)).to.be.equal(0);
      expect(await adapter.integralOf(angle, alice.address)).to.be.equal(integral);
      expect(await gaugeContract.balanceOf(adapter.address)).to.be.equal(parseUnits('0.7', 6));
    });
  });
});
