import { ChainId, registry, StableMasterFront__factory } from '@angleprotocol/sdk';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BigNumber, Signer } from 'ethers';
import { parseEther, parseUnits } from 'ethers/lib/utils';
import hre, { contract, ethers } from 'hardhat';

import {
  MockTokenPermit,
  MockTokenPermit__factory,
  SanTokenERC4626Adapter,
  SanTokenERC4626Adapter__factory,
} from '../../../typechain';
import { expect } from '../utils/chai-setup';
import { deployUpgradeable, expectApprox, MAX_UINT256 } from '../utils/helpers';

contract('SanTokenERC4626Adapter', () => {
  let deployer: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  let adapter: SanTokenERC4626Adapter;
  let usdc: MockTokenPermit;
  let stableMaster: string;
  let poolManager: string;
  let sanRateAtBlock: string;
  let gauge: string;
  let assets: string;
  let sanHolder: string;
  let sanToken: MockTokenPermit;
  let usdcHolder: string;

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
    // gauge address has more in value than what's needed
    gauge = '0x51fE22abAF4a26631b2913E417c0560D547797a7';
    assets = '2101885141874';
    sanHolder = '0x9C215206Da4bf108aE5aEEf9dA7caD3352A36Dad';
    usdcHolder = '0x4943b0c9959dcf58871a799dfb71bece0d97c9f4';
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
    adapter = (await deployUpgradeable(new SanTokenERC4626Adapter__factory(deployer))) as SanTokenERC4626Adapter;
    await adapter.initialize(stableMaster, poolManager);

    const impersonatedAddresses = [usdcHolder];
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
      expect(await adapter.totalAssets()).to.be.equal(assets);
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
      expect(await adapter.totalAssets()).to.be.equal(parseUnits('1', 6).add(assets));
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
      expect(await adapter.totalAssets()).to.be.equal(parseUnits('1', 6).add(assets));
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
      expect(await adapter.totalAssets()).to.be.equal(amount.add(assets).add(1));
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
      expect(await adapter.totalAssets()).to.be.equal(amount.add(assets));
    });
  });
  describe('withdraw', () => {
    it('success - with approval', async () => {
      await usdc.connect(impersonatedSigners[usdcHolder]).approve(adapter.address, MAX_UINT256);
      await adapter.connect(impersonatedSigners[usdcHolder]).mint(parseUnits('1', 6), alice.address);
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
      await expect(adapter.redeem(parseEther('100'), alice.address, alice.address)).to.be.revertedWith('TooHighAmount');
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
});
