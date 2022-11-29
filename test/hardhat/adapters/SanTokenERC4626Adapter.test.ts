import { ChainId, FeeManager__factory, registry, StableMasterFront__factory } from '@angleprotocol/sdk';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BigNumber, Signer } from 'ethers';
import { parseEther, parseUnits } from 'ethers/lib/utils';
import hre, { contract, ethers } from 'hardhat';

import {
  MockTokenPermit,
  MockTokenPermit__factory,
  SanUSDCEURERC4626Adapter,
  SanUSDCEURERC4626Adapter__factory,
} from '../../../typechain';
import { expect } from '../utils/chai-setup';
import { deployUpgradeable, expectApprox, MAX_UINT256, ZERO_ADDRESS } from '../utils/helpers';

contract('SanTokenERC4626Adapter - USDC ', () => {
  let deployer: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  let adapter: SanUSDCEURERC4626Adapter;
  let usdc: MockTokenPermit;
  let stableMaster: string;
  let feeManager: string;
  let poolManager: string;
  let sanRateAtBlock: string;
  let assets: string;
  let sanToken: MockTokenPermit;
  let usdcHolder: string;
  let governor: string;

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
    assets = '2101885141874';
    usdcHolder = '0x4943b0c9959dcf58871a799dfb71bece0d97c9f4';
    feeManager = '0x97B6897AAd7aBa3861c04C0e6388Fc02AF1F227f';
    governor = '0xdC4e6DFe07EFCa50a197DF15D9200883eF4Eb1c8';
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
    adapter = (await deployUpgradeable(new SanUSDCEURERC4626Adapter__factory(deployer))) as SanUSDCEURERC4626Adapter;
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
      expect(await adapter.decimals()).to.be.equal(6);
      expect(await adapter.name()).to.be.equal('Angle sanUSDC_EUR Wrapper');
      expect(await adapter.symbol()).to.be.equal('ag-wrapper-sanUSDC_EUR');
      expect(await adapter.poolManager()).to.be.equal(poolManager);
      expect(await adapter.stableMaster()).to.be.equal(stableMaster);
      expect(await adapter.sanToken()).to.be.equal(sanToken.address);
      expect(await adapter.gauge()).to.be.equal(ZERO_ADDRESS);
      expect(await adapter.totalAssets()).to.be.equal(0);
      expect(await usdc.allowance(adapter.address, stableMaster)).to.be.equal(MAX_UINT256);
      expect(await adapter.asset()).to.be.equal(usdc.address);
      expect(await adapter.maxDeposit(alice.address)).to.be.equal(MAX_UINT256);
      expect(await adapter.maxMint(alice.address)).to.be.equal(MAX_UINT256);
      expect(await adapter.previewMint(parseEther('1'))).to.be.equal(sanRateAtBlock);
      expect(await adapter.previewDeposit(parseUnits('1', 6))).to.be.equal(
        parseUnits('1', 6).mul(parseEther('1')).div(sanRateAtBlock),
      );
      expect(await adapter.convertToAssets(parseEther('1'))).to.be.equal(sanRateAtBlock);
      expect(await adapter.convertToShares(parseUnits('1', 6))).to.be.equal(
        parseUnits('1', 6).mul(parseEther('1')).div(sanRateAtBlock),
      );
      expect(await adapter.availableBalance()).to.be.equal(assets);
      // maxWithdraw when address has no balance
      expect(await adapter.maxWithdraw(alice.address)).to.be.equal(0);
      expect(await adapter.maxRedeem(alice.address)).to.be.equal(0);

      expect(await adapter.previewWithdraw(parseEther('1'))).to.be.equal(MAX_UINT256);
      expect(await adapter.previewWithdraw(parseUnits('1', 6))).to.be.equal(
        parseUnits('1', 6).mul(parseEther('1')).div(sanRateAtBlock).add(1),
      );
      expect(await adapter.previewRedeem(parseUnits('1', 6))).to.be.equal(
        BigNumber.from(sanRateAtBlock).div(parseUnits('1', 12)),
      );
      expect(await adapter.previewRedeem(parseEther('100000000000000'))).to.be.equal(0);
    });
  });
  describe('deposit', () => {
    it('success - from usdc holder', async () => {
      await usdc.connect(impersonatedSigners[usdcHolder]).approve(adapter.address, MAX_UINT256);
      await adapter.connect(impersonatedSigners[usdcHolder]).deposit(parseUnits('1', 6), alice.address);
      const amount = parseUnits('1', 6).mul(parseEther('1')).div(sanRateAtBlock);
      expect(await sanToken.balanceOf(adapter.address)).to.be.equal(amount);
      expect(await adapter.balanceOf(alice.address)).to.be.equal(amount);
      expect(await adapter.availableBalance()).to.be.equal(parseUnits('1', 6).add(assets));
      expectApprox(await adapter.totalAssets(), parseUnits('1', 6), 0.1);
    });
    it('success - when compared to a stableMaster deposit', async () => {
      await usdc.connect(impersonatedSigners[usdcHolder]).approve(stableMaster, MAX_UINT256);
      const stableMasterContract = new ethers.Contract(
        stableMaster,
        StableMasterFront__factory.createInterface(),
        alice,
      );
      await stableMasterContract
        .connect(impersonatedSigners[usdcHolder])
        .deposit(parseUnits('1', 6), alice.address, poolManager);
      const amount = parseUnits('1', 6).mul(parseEther('1')).div(sanRateAtBlock);
      expect(await sanToken.balanceOf(alice.address)).to.be.equal(amount);
      expect(await adapter.availableBalance()).to.be.equal(parseUnits('1', 6).add(assets));
    });
  });
  describe('mint', () => {
    it('success - from usdc holder', async () => {
      await usdc.connect(impersonatedSigners[usdcHolder]).approve(adapter.address, MAX_UINT256);
      await adapter.connect(impersonatedSigners[usdcHolder]).mint(parseUnits('1', 6), alice.address);
      const amount = BigNumber.from(sanRateAtBlock).div(parseUnits('1', 12));
      expect(await sanToken.balanceOf(adapter.address)).to.be.equal(parseUnits('1', 6));
      expect(await adapter.balanceOf(alice.address)).to.be.equal(parseUnits('1', 6));
      // A bit more assets are used in the process
      expect(await adapter.availableBalance()).to.be.equal(amount.add(assets).add(1));
    });
    it('success - when compared to a stableMaster deposit', async () => {
      await usdc.connect(impersonatedSigners[usdcHolder]).approve(stableMaster, MAX_UINT256);
      const stableMasterContract = new ethers.Contract(
        stableMaster,
        StableMasterFront__factory.createInterface(),
        alice,
      );
      const amount = BigNumber.from(sanRateAtBlock).div(parseUnits('1', 12)).add(1);
      await stableMasterContract.connect(impersonatedSigners[usdcHolder]).deposit(amount, alice.address, poolManager);
      expect(await sanToken.balanceOf(alice.address)).to.be.equal(parseUnits('1', 6));
      expect(await adapter.availableBalance()).to.be.equal(amount.add(assets));
    });
  });
  describe('withdraw', () => {
    it('success - with approval', async () => {
      await usdc.connect(impersonatedSigners[usdcHolder]).approve(adapter.address, MAX_UINT256);
      await adapter.connect(impersonatedSigners[usdcHolder]).mint(parseUnits('0.3', 6), alice.address);
      await adapter.connect(impersonatedSigners[usdcHolder]).mint(parseUnits('0.3', 6), alice.address);
      await adapter.connect(impersonatedSigners[usdcHolder]).mint(parseUnits('0.2', 6), alice.address);
      await adapter.connect(impersonatedSigners[usdcHolder]).mint(parseUnits('0.2', 6), alice.address);
      await adapter.connect(alice).approve(usdcHolder, MAX_UINT256);
      const amount = parseUnits('1', 6).mul(parseEther('1')).div(sanRateAtBlock);
      await adapter.connect(impersonatedSigners[usdcHolder]).withdraw(parseUnits('1', 6), bob.address, alice.address);
      expect(await usdc.balanceOf(bob.address)).to.be.equal(parseUnits('1', 6));
      expectApprox(await sanToken.balanceOf(adapter.address), parseUnits('1', 6).sub(amount), 1);
    });
    it('success - without approval', async () => {
      await usdc.connect(impersonatedSigners[usdcHolder]).approve(adapter.address, MAX_UINT256);
      await adapter.connect(impersonatedSigners[usdcHolder]).mint(parseUnits('1', 6), alice.address);
      const amount = parseUnits('1', 6).mul(parseEther('1')).div(sanRateAtBlock);
      await adapter.connect(alice).withdraw(parseUnits('1', 6), bob.address, alice.address);
      expect(await usdc.balanceOf(bob.address)).to.be.equal(parseUnits('1', 6));
      expectApprox(await sanToken.balanceOf(adapter.address), parseUnits('1', 6).sub(amount), 1);
    });
    it('success - withdraw a too large amount', async () => {
      await usdc.connect(impersonatedSigners[usdcHolder]).approve(adapter.address, MAX_UINT256);
      await adapter.connect(impersonatedSigners[usdcHolder]).mint(parseUnits('1', 6), alice.address);

      await expect(adapter.connect(alice).withdraw(parseEther('1'), bob.address, alice.address)).to.be.revertedWith(
        'ERC20: burn amount exceeds balance',
      );
    });
  });
  describe('redeem', () => {
    it('reverts - when too high amount', async () => {
      await expect(adapter.redeem(parseEther('100'), alice.address, alice.address)).to.be.revertedWith(
        'InsufficientAssets',
      );
    });
    it('success - with approval', async () => {
      await usdc.connect(impersonatedSigners[usdcHolder]).approve(adapter.address, MAX_UINT256);
      await adapter.connect(impersonatedSigners[usdcHolder]).mint(parseUnits('1', 6), alice.address);
      await adapter.connect(alice).approve(usdcHolder, MAX_UINT256);
      const amount = parseUnits('1', 6).mul(sanRateAtBlock).div(parseEther('1'));
      await adapter.connect(impersonatedSigners[usdcHolder]).redeem(parseUnits('1', 6), bob.address, alice.address);
      // Amount should be a bit bigger than expected because
      expectApprox(await usdc.balanceOf(bob.address), amount, 0.1);
      expect(await sanToken.balanceOf(adapter.address)).to.be.equal(0);
    });
    it('success - without approval', async () => {
      await usdc.connect(impersonatedSigners[usdcHolder]).approve(adapter.address, MAX_UINT256);
      await adapter.connect(impersonatedSigners[usdcHolder]).mint(parseUnits('1', 6), alice.address);
      const amount = parseUnits('1', 6).mul(sanRateAtBlock).div(parseEther('1'));
      await adapter.connect(alice).redeem(parseUnits('1', 6), bob.address, alice.address);
      expectApprox(await usdc.balanceOf(bob.address), amount, 0.1);
      expect(await sanToken.balanceOf(adapter.address)).to.be.equal(0);
    });
  });
  describe('slippage', () => {
    it('success - withdrawal values are now smaller', async () => {
      const feeManagerContract = new ethers.Contract(feeManager, FeeManager__factory.createInterface(), alice);
      await feeManagerContract.connect(impersonatedSigners[governor]).setFees([0], [parseUnits('0.2', 9)], 3);
      await feeManagerContract.connect(impersonatedSigners[governor]).updateUsersSLP();
      // Slippage should be 20%
      expect(await adapter.previewWithdraw(parseEther('1'))).to.be.equal(MAX_UINT256);
      expect(await adapter.previewWithdraw(parseUnits('1', 6))).to.be.equal(
        parseUnits('1.25', 6).mul(parseEther('1')).div(sanRateAtBlock).add(1),
      );
      expect(await adapter.previewRedeem(parseUnits('1', 6))).to.be.equal(
        BigNumber.from(sanRateAtBlock).div(parseUnits('1.25', 12)),
      );
      expect(await adapter.previewRedeem(parseEther('100000000000000'))).to.be.equal(0);

      await usdc.connect(impersonatedSigners[usdcHolder]).approve(adapter.address, MAX_UINT256);
      await adapter.connect(impersonatedSigners[usdcHolder]).mint(parseUnits('1', 6), alice.address);
      const amount = BigNumber.from(sanRateAtBlock).div(parseUnits('1', 12));
      expect(await sanToken.balanceOf(adapter.address)).to.be.equal(parseUnits('1', 6));
      expect(await adapter.balanceOf(alice.address)).to.be.equal(parseUnits('1', 6));
      // A bit more assets are used in the process
      expect(await adapter.availableBalance()).to.be.equal(amount.add(assets).add(1));
      // Now has 1 USDC worth of sanToken
      expectApprox(
        await adapter.maxWithdraw(alice.address),
        BigNumber.from(sanRateAtBlock).div(parseUnits('1.25', 12)),
        0.1,
      );
      expect(await adapter.maxRedeem(alice.address)).to.be.equal(parseUnits('1', 6));
      // Redeeming half of the shares
      await adapter.connect(alice).redeem(parseUnits('0.5', 6), bob.address, alice.address);
      const balance = await usdc.balanceOf(bob.address);
      expectApprox(balance, BigNumber.from(sanRateAtBlock).div(parseUnits('2.5', 12)), 0.1);
      expect(await adapter.balanceOf(alice.address)).to.be.equal(parseUnits('0.5', 6));
      expect(await sanToken.balanceOf(adapter.address)).to.be.equal(parseUnits('0.5', 6));

      // Now testing a withdrawal
      await expect(adapter.connect(alice).withdraw(parseUnits('0.5', 6), bob.address, alice.address)).to.be.reverted;
      await adapter.connect(alice).withdraw(parseUnits('0.2', 6), bob.address, alice.address);
      expect(await usdc.balanceOf(bob.address)).to.be.equal(balance.add(parseUnits('0.2', 6)));
      // 0.2*1.25=0.25
      expectApprox(
        await adapter.balanceOf(alice.address),
        parseUnits('0.5', 6).sub(parseUnits('0.25', 6).mul(parseEther('1')).div(sanRateAtBlock)),
        0.1,
      );
    });
  });
});
