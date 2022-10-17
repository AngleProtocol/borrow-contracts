import { ChainId, CONTRACTS_ADDRESSES, Interfaces } from '@angleprotocol/sdk';
import { ethers } from 'hardhat';

import { expect } from '../../test/hardhat/utils/chai-setup';

async function main() {
  const { deployer } = await ethers.getNamedSigners();
  let routerAddress: string;
  let router;
  routerAddress = CONTRACTS_ADDRESSES[ChainId.MAINNET].AngleRouter!;
  router = new ethers.Contract(routerAddress, Interfaces.AngleRouter_Interface, deployer);
  expect(await router.governor()).to.be.equal(CONTRACTS_ADDRESSES[ChainId.MAINNET].GovernanceMultiSig!);
  expect(await router.guardian()).to.be.equal(CONTRACTS_ADDRESSES[ChainId.MAINNET].Guardian!);
  expect(await router.uniswapV3Router()).to.be.equal('0xE592427A0AEce92De3Edee1F18E0157C05861564');
  expect(await router.oneInch()).to.be.equal('0x1111111254fb6c44bAC0beD2854e76F90643097d');
  const agEUR = CONTRACTS_ADDRESSES[ChainId.MAINNET].agEUR.AgToken!;
  const stableMaster = CONTRACTS_ADDRESSES[ChainId.MAINNET].agEUR.StableMaster!;
  const usdc = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
  expect(await router.mapStableMasters(agEUR)).to.be.equal(stableMaster);
  const poolManagerUSDC = CONTRACTS_ADDRESSES[ChainId.MAINNET].agEUR.collaterals!.USDC.PoolManager!;
  const perpetualManagerUSDC = CONTRACTS_ADDRESSES[ChainId.MAINNET].agEUR.collaterals!.USDC.PerpetualManager!;
  const sanTokenUSDC = CONTRACTS_ADDRESSES[ChainId.MAINNET].agEUR.collaterals!.USDC.SanToken!;
  const gaugeUSDC = CONTRACTS_ADDRESSES[ChainId.MAINNET].agEUR.collaterals!.USDC.LiquidityGauge!;
  const struct = await router.mapPoolManagers(stableMaster, usdc);
  expect(struct.poolManager).to.be.equal(poolManagerUSDC);
  expect(struct.perpetualManager).to.be.equal(perpetualManagerUSDC);
  expect(struct.sanToken).to.be.equal(sanTokenUSDC);
  expect(struct.gauge).to.be.equal(gaugeUSDC);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
