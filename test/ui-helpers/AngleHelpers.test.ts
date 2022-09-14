import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { ethers, network } from 'hardhat';
import { utils, BigNumber, Contract } from 'ethers';
import { expect } from '../utils/chai-setup';
import { AngleHelpers, AngleHelpers__factory } from '../../typechain';
import { parseUnits } from 'ethers/lib/utils';
import { deployUpgradeable, ZERO_ADDRESS } from '../utils/helpers';

describe('AngleHelpers', () => {
  let helpers: AngleHelpers;
  let deployer: SignerWithAddress;
  let usdc: string;
  let agEUR: string;
  let dai: string;
  let frax: string;
  let ohm: string;

  before(async () => {
    [deployer] = await ethers.getSigners();
    await network.provider.request({
      method: 'hardhat_reset',
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.ETH_NODE_URI_FORK,
            blockNumber: 15533592,
          },
        },
      ],
    });
    helpers = (await deployUpgradeable(new AngleHelpers__factory(deployer))) as AngleHelpers;
    usdc = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
    agEUR = '0x1a7e4e63778B4f12a199C062f3eFdD288afCBce8';
    dai = '0x6B175474E89094C44Da98b954EedeAC495271d0F';
    frax = '0x853d955aCEf822Db058eb8505911ED77F175b99e';
    ohm = '0x64aa3364F17a4D01c6f1751Fd97C2BD3D7e7f1D5';
  });

  describe('getCollateralAddresses', () => {
    it('success', async () => {
      const result = await helpers.getCollateralAddresses(agEUR, usdc);
      console.log(result);
    });
  });
  describe('getCollateralParameters', () => {
    it('success', async () => {
      const result = await helpers.getCollateralParameters(agEUR, usdc);
      console.log(result.feeData);
      console.log('');
      console.log(result.slpData);
      console.log('');
      console.log(result.perpFeeData);
      console.log('');
      console.log(result.perpParam);
    });
  });
  describe('getStablecoinAddresses', () => {
    it('success', async () => {
      const result = await helpers.getStablecoinAddresses();
      console.log(result);
    });
  });
  describe('previewMint', () => {
    it('success - usdc', async () => {
      const result = await helpers.previewMint(parseUnits('1', 6), agEUR, usdc);
      console.log(result.toString());
    });
    it('success - dai', async () => {
      const result = await helpers.previewMint(parseUnits('1', 18), agEUR, dai);
      console.log(result.toString());
    });
    it('success - frax', async () => {
      const result = await helpers.previewMint(parseUnits('1', 18), agEUR, frax);
      console.log(result.toString());
    });
    it('reverts - when too high amount', async () => {
      await expect(helpers.previewMint(parseUnits('1', 28), agEUR, frax)).to.be.revertedWith('InvalidAmount');
    });
    it('reverts - on an unknown token', async () => {
      await expect(helpers.previewMint(parseUnits('1', 18), agEUR, ohm)).to.be.revertedWith('NotInitialized');
    });
  });
  describe('previewBurn', () => {
    it('success - usdc', async () => {
      const result = await helpers.previewBurn(parseUnits('1', 18), agEUR, usdc);
      // This is exactly the amount we would have gotten on Tenderly at the same block
      console.log(result.toString());
    });
    it('success - dai', async () => {
      const result = await helpers.previewBurn(parseUnits('1', 18), agEUR, dai);
      // This is exactly the amount we would have gotten on Tenderly at the same block
      console.log(result.toString());
    });
    it('success - frax', async () => {
      const result = await helpers.previewBurn(parseUnits('1', 18), agEUR, frax);
      // This is exactly the amount we would have gotten on Tenderly at the same block
      console.log(result.toString());
    });
    it('reverts - when too high amount', async () => {
      await expect(helpers.previewBurn(parseUnits('1', 25), agEUR, frax)).to.be.revertedWith('InvalidAmount');
      await expect(helpers.previewBurn(parseUnits('1', 28), agEUR, usdc)).to.be.revertedWith('InvalidAmount');
      await expect(helpers.previewBurn(parseUnits('1', 28), agEUR, dai)).to.be.revertedWith('InvalidAmount');
    });
    it('reverts - on an unknown token', async () => {
      await expect(helpers.previewBurn(parseUnits('1', 18), agEUR, ohm)).to.be.revertedWith('NotInitialized');
    });
  });
  describe('previewMintAndFees', () => {
    it('success - usdc', async () => {
      const result = await helpers.previewMintAndFees(parseUnits('1', 6), agEUR, usdc);
      console.log(result[0].toString());
      console.log(result[1].toString());
    });
    it('success - dai', async () => {
      const result = await helpers.previewMintAndFees(parseUnits('1', 18), agEUR, dai);
      console.log(result[0].toString());
      console.log(result[1].toString());
    });
    it('success - frax', async () => {
      const result = await helpers.previewMintAndFees(parseUnits('1', 18), agEUR, frax);
      console.log(result[0].toString());
      console.log(result[1].toString());
    });
    it('reverts - on an unknown token', async () => {
      await expect(helpers.previewMintAndFees(parseUnits('1', 18), agEUR, ohm)).to.be.revertedWith('NotInitialized');
    });
  });
  describe('previewBurnAndFees', () => {
    it('success - usdc', async () => {
      const result = await helpers.previewBurnAndFees(parseUnits('1', 18), agEUR, usdc);
      console.log(result[0].toString());
      console.log(result[1].toString());
    });
    it('success - dai', async () => {
      const result = await helpers.previewBurnAndFees(parseUnits('1', 18), agEUR, dai);
      console.log(result[0].toString());
      console.log(result[1].toString());
    });
    it('success - frax', async () => {
      const result = await helpers.previewBurnAndFees(parseUnits('1', 18), agEUR, frax);
      console.log(result[0].toString());
      console.log(result[1].toString());
    });
    it('reverts - on an unknown token', async () => {
      await expect(helpers.previewBurnAndFees(parseUnits('1', 18), agEUR, ohm)).to.be.revertedWith('NotInitialized');
    });
  });
});
