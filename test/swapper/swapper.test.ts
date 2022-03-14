import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { parseEther, parseUnits } from 'ethers/lib/utils';
import { contract, ethers, web3 } from 'hardhat';

import {
  MockCoreBorrow,
  MockCoreBorrow__factory,
  Swapper,
  Swapper__factory,
  MockRouter,
  MockRouter__factory,
  MockToken,
  MockToken__factory,
} from '../../typechain';
import { expect } from '../utils/chai-setup';
import { MAX_UINT256, ZERO_ADDRESS } from '../utils/helpers';

contract('Swapper', () => {
  let deployer: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  let swapper: Swapper;
  let router: MockRouter;
  let core: MockCoreBorrow;
  let collateral: MockToken;
  let stablecoin: MockToken;
  let stETH: MockToken;

  beforeEach(async () => {
    [deployer, alice, bob] = await ethers.getSigners();
    core = (await new MockCoreBorrow__factory(deployer).deploy()) as MockCoreBorrow;
    router = (await new MockRouter__factory(deployer).deploy()) as MockRouter;
    collateral = (await new MockToken__factory(deployer).deploy('wETH', 'wETH', 18)) as MockToken;
    stablecoin = (await new MockToken__factory(deployer).deploy('agEUR', 'agEUR', 18)) as MockToken;
    stETH = (await new MockToken__factory(deployer).deploy('stETH', 'stETH', 18)) as MockToken;
    await router.setMultipliers(parseUnits('1', 9), parseUnits('1', 9));
    await router.setStETH(stETH.address);
    await router.setInOut(collateral.address, stablecoin.address);
    await router.setStETHMultiplier(parseUnits('1', 9));
    swapper = (await new Swapper__factory(deployer).deploy(
      core.address,
      router.address,
      router.address,
      router.address,
      router.address,
    )) as Swapper;
  });
  describe('constructor', () => {
    it('success - contract initialized', async () => {
      expect(await swapper.core()).to.be.equal(core.address);
      expect(await swapper.angleRouter()).to.be.equal(router.address);
      expect(await swapper.wStETH()).to.be.equal(router.address);
      expect(await swapper.oneInch()).to.be.equal(router.address);
      expect(await swapper.uniV3Router()).to.be.equal(router.address);
      expect(await stETH.allowance(swapper.address, router.address)).to.be.equal(MAX_UINT256);
    });
    it('reverts - zero address', async () => {
      await expect(
        new Swapper__factory(deployer).deploy(
          ZERO_ADDRESS,
          router.address,
          router.address,
          router.address,
          router.address,
        ),
      ).to.be.revertedWith('0');
      await expect(
        new Swapper__factory(deployer).deploy(
          core.address,
          ZERO_ADDRESS,
          router.address,
          router.address,
          router.address,
        ),
      ).to.be.reverted;
      await expect(
        new Swapper__factory(deployer).deploy(
          core.address,
          router.address,
          ZERO_ADDRESS,
          router.address,
          router.address,
        ),
      ).to.be.revertedWith('0');
      await expect(
        new Swapper__factory(deployer).deploy(
          core.address,
          router.address,
          router.address,
          ZERO_ADDRESS,
          router.address,
        ),
      ).to.be.revertedWith('0');
      await expect(
        new Swapper__factory(deployer).deploy(
          core.address,
          router.address,
          router.address,
          router.address,
          ZERO_ADDRESS,
        ),
      ).to.be.revertedWith('0');
    });
  });
  describe('swap - UniswapV3', () => {
    it('reverts - invalid balance', async () => {
      const data = ethers.utils.defaultAbiCoder.encode(
        ['address', 'address', 'uint256', 'uint128', 'uint128', 'bytes'],
        [ZERO_ADDRESS, bob.address, 0, 0, 0, '0x'],
      );
      await expect(
        swapper.swap(collateral.address, stablecoin.address, alice.address, parseEther('1'), parseEther('1'), data),
      ).to.be.reverted;
    });
    it('reverts - invalid data', async () => {
      await collateral.mint(swapper.address, parseEther('1'));
      await expect(
        swapper.swap(collateral.address, stablecoin.address, alice.address, parseEther('1'), parseEther('1'), '0x'),
      ).to.be.reverted;
    });
    it('success - simple data', async () => {
      await collateral.mint(swapper.address, parseEther('1'));
      await stablecoin.mint(router.address, parseEther('1'));
      const data = ethers.utils.defaultAbiCoder.encode(
        ['address', 'address', 'uint256', 'uint128', 'uint128', 'bytes'],
        [ZERO_ADDRESS, bob.address, 0, 0, 0, '0x'],
      );
      await swapper.swap(collateral.address, stablecoin.address, alice.address, parseEther('1'), parseEther('1'), data);
      expect(await router.counterUni()).to.be.equal(1);
      expect(await stablecoin.balanceOf(swapper.address)).to.be.equal(0);
      expect(await stablecoin.balanceOf(router.address)).to.be.equal(0);
      expect(await collateral.balanceOf(router.address)).to.be.equal(parseEther('1'));
      expect(await collateral.balanceOf(swapper.address)).to.be.equal(parseEther('0'));
      expect(await stablecoin.balanceOf(alice.address)).to.be.equal(parseEther('1'));
      expect(await collateral.balanceOf(alice.address)).to.be.equal(parseEther('0'));
      expect(await swapper.uniAllowedToken(collateral.address)).to.be.equal(true);
      expect(await collateral.allowance(swapper.address, router.address)).to.be.equal(MAX_UINT256.sub(parseEther('1')));
    });
    it('success - simple data but with an allowance already given and more collateral obtained', async () => {
      await collateral.mint(swapper.address, parseEther('2'));
      await stablecoin.mint(router.address, parseEther('3'));
      let data = ethers.utils.defaultAbiCoder.encode(
        ['address', 'address', 'uint256', 'uint128', 'uint128', 'bytes'],
        [ZERO_ADDRESS, bob.address, 0, 0, 0, '0x'],
      );
      await swapper.swap(collateral.address, stablecoin.address, alice.address, parseEther('1'), parseEther('1'), data);
      await router.setMultipliers(parseUnits('1.5', 9), parseUnits('1', 9));
      await swapper.swap(collateral.address, stablecoin.address, alice.address, parseEther('1'), parseEther('1'), data);
      expect(await router.counterUni()).to.be.equal(2);
      expect(await stablecoin.balanceOf(swapper.address)).to.be.equal(0);
      expect(await stablecoin.balanceOf(router.address)).to.be.equal(parseEther('0.5'));
      expect(await collateral.balanceOf(router.address)).to.be.equal(parseEther('2'));
      expect(await collateral.balanceOf(swapper.address)).to.be.equal(parseEther('0'));
      expect(await stablecoin.balanceOf(alice.address)).to.be.equal(parseEther('2'));
      expect(await stablecoin.balanceOf(bob.address)).to.be.equal(parseEther('0.5'));
      expect(await collateral.balanceOf(alice.address)).to.be.equal(parseEther('0'));
      expect(await swapper.uniAllowedToken(collateral.address)).to.be.equal(true);
      expect(await collateral.allowance(swapper.address, router.address)).to.be.equal(MAX_UINT256.sub(parseEther('2')));
    });
    it('reverts - too small amount obtained from Uniswap', async () => {
      await collateral.mint(swapper.address, parseEther('2'));
      await stablecoin.mint(router.address, parseEther('3'));
      let data = ethers.utils.defaultAbiCoder.encode(
        ['address', 'address', 'uint256', 'uint128', 'uint128', 'bytes'],
        [ZERO_ADDRESS, bob.address, 0, 0, 0, '0x'],
      );
      await swapper.swap(collateral.address, stablecoin.address, alice.address, parseEther('1'), parseEther('1'), data);
      await router.setMultipliers(parseUnits('0.5', 9), parseUnits('1', 9));
      await expect(
        swapper.swap(collateral.address, stablecoin.address, alice.address, parseEther('1'), parseEther('1'), data),
      ).to.be.reverted;
    });
    it('success - with mint from protocol using stETH as intermediate token', async () => {
      // The flow is to swap to stETH and then mint stablecoins from the protocol
      // Flow is collateral -> stablecoin through swap and then stablecoin -> stETH from mint
      await collateral.mint(swapper.address, parseEther('1'));
      await stETH.mint(router.address, parseEther('1'));
      await stablecoin.mint(router.address, parseEther('1'));
      let data = ethers.utils.defaultAbiCoder.encode(
        ['address', 'address', 'uint256', 'uint128', 'uint128', 'bytes'],
        [stablecoin.address, bob.address, 0, 0, 2, '0x'],
      );
      await swapper.swap(collateral.address, stETH.address, alice.address, parseEther('1'), parseEther('1'), data);
      expect(await router.counterUni()).to.be.equal(1);
      expect(await router.counterAngleMint()).to.be.equal(1);
      expect(await swapper.uniAllowedToken(collateral.address)).to.be.equal(true);
      expect(await swapper.angleRouterAllowedToken(stablecoin.address)).to.be.equal(true);
      expect(await swapper.angleRouterAllowedToken(stETH.address)).to.be.equal(false);
      expect(await swapper.angleRouterAllowedToken(collateral.address)).to.be.equal(false);
      expect(await stETH.balanceOf(alice.address)).to.be.equal(parseEther('1'));
      expect(await stablecoin.balanceOf(router.address)).to.be.equal(parseEther('1'));
      expect(await collateral.balanceOf(router.address)).to.be.equal(parseEther('1'));
    });
    it('success - with mint from protocol using stETH as intermediate token and with variable amounts', async () => {
      await collateral.mint(swapper.address, parseEther('1'));
      await stETH.mint(router.address, parseEther('2'));
      await stablecoin.mint(router.address, parseEther('2'));
      let data = ethers.utils.defaultAbiCoder.encode(
        ['address', 'address', 'uint256', 'uint128', 'uint128', 'bytes'],
        [stablecoin.address, bob.address, 0, 0, 2, '0x'],
      );
      await router.setMultipliers(parseUnits('1.5', 9), parseUnits('1', 9));
      await swapper.swap(collateral.address, stETH.address, alice.address, parseEther('1'), parseEther('1'), data);
      expect(await router.counterUni()).to.be.equal(1);
      expect(await router.counterAngleMint()).to.be.equal(1);
      expect(await stETH.balanceOf(alice.address)).to.be.equal(parseEther('1'));
      expect(await stETH.balanceOf(bob.address)).to.be.equal(parseEther('0.5'));
      expect(await stETH.balanceOf(router.address)).to.be.equal(parseEther('0.5'));
      expect(await stablecoin.balanceOf(router.address)).to.be.equal(parseEther('2'));
      expect(await collateral.balanceOf(router.address)).to.be.equal(parseEther('1'));
    });
    it('success - with mint and already approved token from protocol using stETH as intermediate token and with variable amounts', async () => {
      await collateral.mint(swapper.address, parseEther('2'));
      await stETH.mint(router.address, parseEther('3'));
      await stablecoin.mint(router.address, parseEther('3'));
      let data = ethers.utils.defaultAbiCoder.encode(
        ['address', 'address', 'uint256', 'uint128', 'uint128', 'bytes'],
        [stablecoin.address, bob.address, 0, 0, 2, '0x'],
      );
      await router.setMultipliers(parseUnits('1.5', 9), parseUnits('1', 9));
      await swapper.swap(collateral.address, stETH.address, alice.address, parseEther('1'), parseEther('1'), data);
      await swapper.swap(collateral.address, stETH.address, alice.address, parseEther('1'), parseEther('1'), data);
      expect(await router.counterUni()).to.be.equal(2);
      expect(await router.counterAngleMint()).to.be.equal(2);
      expect(await stETH.balanceOf(alice.address)).to.be.equal(parseEther('2'));
      expect(await stETH.balanceOf(bob.address)).to.be.equal(parseEther('1'));
      expect(await stablecoin.balanceOf(router.address)).to.be.equal(parseEther('3'));
      expect(await collateral.balanceOf(router.address)).to.be.equal(parseEther('2'));
    });
    it('success - with mint and variable amounts from the mint', async () => {
      await collateral.mint(swapper.address, parseEther('2'));
      await stETH.mint(router.address, parseEther('3'));
      await stablecoin.mint(router.address, parseEther('3'));
      let data = ethers.utils.defaultAbiCoder.encode(
        ['address', 'address', 'uint256', 'uint128', 'uint128', 'bytes'],
        [stablecoin.address, bob.address, 0, 0, 2, '0x'],
      );
      await router.setMultipliers(parseUnits('1', 9), parseUnits('0.5', 9));
      await swapper.swap(collateral.address, stETH.address, alice.address, parseEther('1'), parseEther('1'), data);
      expect(await router.counterUni()).to.be.equal(1);
      expect(await router.counterAngleMint()).to.be.equal(1);
      expect(await stETH.balanceOf(alice.address)).to.be.equal(parseEther('1'));
      expect(await stETH.balanceOf(bob.address)).to.be.equal(parseEther('1'));
      expect(await stablecoin.balanceOf(router.address)).to.be.equal(parseEther('3'));
      expect(await collateral.balanceOf(router.address)).to.be.equal(parseEther('1'));
    });
    it('success - with mint and weird variable amounts from the mint and swap', async () => {
      await collateral.mint(swapper.address, parseEther('2'));
      await stETH.mint(router.address, parseEther('3'));
      await stablecoin.mint(router.address, parseEther('3'));
      let data = ethers.utils.defaultAbiCoder.encode(
        ['address', 'address', 'uint256', 'uint128', 'uint128', 'bytes'],
        [stablecoin.address, bob.address, 0, 0, 2, '0x'],
      );
      await router.setMultipliers(parseUnits('0.6', 9), parseUnits('0.5', 9));
      // 1 collateral -> 2 stablecoin -> 2*0.6 = 1.2 stETH
      await swapper.swap(collateral.address, stETH.address, alice.address, parseEther('1'), parseEther('1'), data);
      expect(await router.counterUni()).to.be.equal(1);
      expect(await router.counterAngleMint()).to.be.equal(1);
      expect(await stETH.balanceOf(alice.address)).to.be.equal(parseEther('1'));
      expect(await stETH.balanceOf(bob.address)).to.be.equal(parseEther('0.2'));
      expect(await stETH.balanceOf(router.address)).to.be.equal(parseEther('1.8'));
      expect(await stablecoin.balanceOf(router.address)).to.be.equal(parseEther('3'));
      expect(await collateral.balanceOf(router.address)).to.be.equal(parseEther('1'));
    });
    it('success - with burn', async () => {
      // Flow for burn is stETH -> collateral -> stablecoin
      await stETH.mint(swapper.address, parseEther('1'));
      await collateral.mint(router.address, parseEther('1'));
      await stablecoin.mint(router.address, parseEther('1'));
      let data = ethers.utils.defaultAbiCoder.encode(
        ['address', 'address', 'uint256', 'uint128', 'uint128', 'bytes'],
        [collateral.address, bob.address, 0, 0, 1, '0x'],
      );
      // 1 stETH -> 1 collateral -> 1 stablecoin
      await swapper.swap(stETH.address, stablecoin.address, alice.address, parseEther('1'), parseEther('1'), data);
      expect(await router.counterUni()).to.be.equal(1);
      expect(await router.counterAngleMint()).to.be.equal(0);
      expect(await router.counterAngleBurn()).to.be.equal(1);
      expect(await stETH.balanceOf(router.address)).to.be.equal(parseEther('1'));
      expect(await stablecoin.balanceOf(alice.address)).to.be.equal(parseEther('1'));
      expect(await collateral.balanceOf(router.address)).to.be.equal(parseEther('1'));
      expect(await swapper.angleRouterAllowedToken(stETH.address)).to.be.equal(true);
      expect(await swapper.angleRouterAllowedToken(stablecoin.address)).to.be.equal(false);
      expect(await swapper.angleRouterAllowedToken(collateral.address)).to.be.equal(false);
    });
    it('success - with burn and variable amounts', async () => {
      await stETH.mint(swapper.address, parseEther('1'));
      await collateral.mint(router.address, parseEther('1'));
      await stablecoin.mint(router.address, parseEther('2'));
      let data = ethers.utils.defaultAbiCoder.encode(
        ['address', 'address', 'uint256', 'uint128', 'uint128', 'bytes'],
        [collateral.address, bob.address, 0, 0, 1, '0x'],
      );
      // 1 stETH -> 0.5 collateral -> 2 stablecoin
      await router.setMultipliers(parseUnits('4', 9), parseUnits('0.5', 9));
      await swapper.swap(stETH.address, stablecoin.address, alice.address, parseEther('1'), parseEther('1'), data);
      expect(await router.counterUni()).to.be.equal(1);
      expect(await router.counterAngleMint()).to.be.equal(0);
      expect(await router.counterAngleBurn()).to.be.equal(1);
      expect(await stETH.balanceOf(router.address)).to.be.equal(parseEther('1'));
      expect(await stablecoin.balanceOf(alice.address)).to.be.equal(parseEther('1'));
      expect(await stablecoin.balanceOf(bob.address)).to.be.equal(parseEther('1'));
      expect(await collateral.balanceOf(router.address)).to.be.equal(parseEther('1'));
    });
    it('success - with multiple burn and variable amounts', async () => {
      await stETH.mint(swapper.address, parseEther('2'));
      await collateral.mint(router.address, parseEther('2'));
      await stablecoin.mint(router.address, parseEther('2'));
      let data = ethers.utils.defaultAbiCoder.encode(
        ['address', 'address', 'uint256', 'uint128', 'uint128', 'bytes'],
        [collateral.address, bob.address, 0, 0, 1, '0x'],
      );
      // 1 stETH -> 1 collateral -> 1 stablecoin
      await swapper.swap(stETH.address, stablecoin.address, alice.address, parseEther('1'), parseEther('1'), data);
      // 1 stETH -> 1 collateral -> 1 stablecoin
      await swapper.swap(stETH.address, stablecoin.address, alice.address, parseEther('1'), parseEther('1'), data);
      expect(await router.counterUni()).to.be.equal(2);
      expect(await router.counterAngleMint()).to.be.equal(0);
      expect(await router.counterAngleBurn()).to.be.equal(2);
      expect(await stETH.balanceOf(router.address)).to.be.equal(parseEther('2'));
      expect(await stablecoin.balanceOf(alice.address)).to.be.equal(parseEther('2'));
      expect(await collateral.balanceOf(router.address)).to.be.equal(parseEther('2'));
    });
    it('reverts - with burn and incorrect amounts', async () => {
      await stETH.mint(swapper.address, parseEther('1'));
      await collateral.mint(router.address, parseEther('1'));
      await stablecoin.mint(router.address, parseEther('2'));
      let data = ethers.utils.defaultAbiCoder.encode(
        ['address', 'address', 'uint256', 'uint128', 'uint128', 'bytes'],
        [collateral.address, bob.address, 0, 0, 1, '0x'],
      );
      await router.setMultipliers(parseUnits('0.25', 9), parseUnits('0.5', 9));
      await expect(
        swapper.swap(stETH.address, stablecoin.address, alice.address, parseEther('1'), parseEther('1'), data),
      ).to.be.reverted;
    });
  });

  describe('swap - just mint', () => {
    it('reverts - invalid swap type', async () => {
      // The flow is to swap to stETH and then mint stablecoins from the protocol
      // Flow is collateral -> stablecoin through swap and then stablecoin -> stETH from mint
      await collateral.mint(swapper.address, parseEther('1'));
      await stETH.mint(router.address, parseEther('1'));
      await stablecoin.mint(router.address, parseEther('1'));
      let data = ethers.utils.defaultAbiCoder.encode(
        ['address', 'address', 'uint256', 'uint128', 'uint128', 'bytes'],
        [stablecoin.address, bob.address, 0, 10, 2, '0x'],
      );
      await expect(
        swapper.swap(collateral.address, stETH.address, alice.address, parseEther('1'), parseEther('1'), data),
      ).to.be.reverted;
    });
    it('success - no swap and just a mint', async () => {
      // The flow is to swap to stETH and then directly mint stablecoins
      await stETH.mint(swapper.address, parseEther('1'));
      await stablecoin.mint(router.address, parseEther('1'));
      let data = ethers.utils.defaultAbiCoder.encode(
        ['address', 'address', 'uint256', 'uint128', 'uint128', 'bytes'],
        [stETH.address, bob.address, 0, 3, 2, '0x'],
      );
      await swapper.swap(stETH.address, stablecoin.address, alice.address, parseEther('1'), parseEther('1'), data);
      expect(await swapper.uniAllowedToken(stETH.address)).to.be.equal(false);
      expect(await swapper.angleRouterAllowedToken(stETH.address)).to.be.equal(true);
      expect(await router.counterUni()).to.be.equal(0);
      expect(await router.counterAngleMint()).to.be.equal(1);
      expect(await stETH.allowance(swapper.address, router.address)).to.be.equal(MAX_UINT256.sub(parseEther('1')));
      expect(await stablecoin.balanceOf(alice.address)).to.be.equal(parseEther('1'));
      expect(await stETH.balanceOf(router.address)).to.be.equal(parseEther('1'));
    });
    it('success - no swap and just a mint with variable amounts', async () => {
      // The flow is to swap to stETH and then directly mint stablecoins
      await stETH.mint(swapper.address, parseEther('1'));
      await stablecoin.mint(router.address, parseEther('2'));
      let data = ethers.utils.defaultAbiCoder.encode(
        ['address', 'address', 'uint256', 'uint128', 'uint128', 'bytes'],
        [stETH.address, bob.address, 0, 3, 2, '0x'],
      );
      await router.setMultipliers(parseUnits('1', 9), parseUnits('0.5', 9));
      await swapper.swap(stETH.address, stablecoin.address, alice.address, parseEther('1'), parseEther('1'), data);
      expect(await swapper.uniAllowedToken(stETH.address)).to.be.equal(false);
      expect(await router.counterUni()).to.be.equal(0);
      expect(await router.counterAngleMint()).to.be.equal(1);
      expect(await swapper.angleRouterAllowedToken(stETH.address)).to.be.equal(true);
      expect(await stablecoin.balanceOf(alice.address)).to.be.equal(parseEther('1'));
      expect(await stablecoin.balanceOf(bob.address)).to.be.equal(parseEther('1'));
      expect(await stETH.balanceOf(router.address)).to.be.equal(parseEther('1'));
    });
  });
  describe('swap - just burn', () => {
    it('success - no swap and just a burn', async () => {
      // The flow is to swap to stETH and then directly mint stablecoins
      await stETH.mint(router.address, parseEther('1'));
      await stablecoin.mint(swapper.address, parseEther('1'));
      let data = ethers.utils.defaultAbiCoder.encode(
        ['address', 'address', 'uint256', 'uint128', 'uint128', 'bytes'],
        [stETH.address, bob.address, 0, 3, 1, '0x'],
      );
      await swapper.swap(stablecoin.address, stETH.address, alice.address, parseEther('1'), parseEther('1'), data);
      expect(await swapper.uniAllowedToken(stETH.address)).to.be.equal(false);
      expect(await swapper.angleRouterAllowedToken(stablecoin.address)).to.be.equal(true);
      expect(await stablecoin.allowance(swapper.address, router.address)).to.be.equal(MAX_UINT256.sub(parseEther('1')));
      expect(await stablecoin.balanceOf(router.address)).to.be.equal(parseEther('1'));
      expect(await stETH.balanceOf(alice.address)).to.be.equal(parseEther('1'));
      expect(await router.counterAngleBurn()).to.be.equal(1);
    });
    it('success - no swap and just a burn with weird amounts', async () => {
      // The flow is to swap to stETH and then directly mint stablecoins
      await stETH.mint(router.address, parseEther('2'));
      await stablecoin.mint(swapper.address, parseEther('1'));
      let data = ethers.utils.defaultAbiCoder.encode(
        ['address', 'address', 'uint256', 'uint128', 'uint128', 'bytes'],
        [stETH.address, bob.address, 0, 3, 1, '0x'],
      );
      await router.setMultipliers(parseUnits('1', 9), parseUnits('2', 9));
      await swapper.swap(stablecoin.address, stETH.address, alice.address, parseEther('1'), parseEther('1'), data);
      expect(await swapper.uniAllowedToken(stETH.address)).to.be.equal(false);
      expect(await swapper.angleRouterAllowedToken(stablecoin.address)).to.be.equal(true);
      expect(await stablecoin.balanceOf(router.address)).to.be.equal(parseEther('1'));
      expect(await stETH.balanceOf(alice.address)).to.be.equal(parseEther('1'));
      expect(await stETH.balanceOf(bob.address)).to.be.equal(parseEther('1'));
      expect(await router.counterAngleBurn()).to.be.equal(1);
    });
    it('reverts - too small amounts', async () => {
      // The flow is to swap to stETH and then directly mint stablecoins
      await stETH.mint(router.address, parseEther('2'));
      await stablecoin.mint(swapper.address, parseEther('1'));
      let data = ethers.utils.defaultAbiCoder.encode(
        ['address', 'address', 'uint256', 'uint128', 'uint128', 'bytes'],
        [stETH.address, bob.address, 0, 3, 1, '0x'],
      );
      await router.setMultipliers(parseUnits('1', 9), parseUnits('0.5', 9));
      await expect(
        swapper.swap(stablecoin.address, stETH.address, alice.address, parseEther('1'), parseEther('1'), data),
      ).to.be.reverted;
    });
  });

  describe('swap - wStETH', () => {
    it('reverts - not enough stETH available', async () => {
      await stETH.mint(swapper.address, parseEther('0.9'));
      await stablecoin.mint(router.address, parseEther('1'));
      let data = ethers.utils.defaultAbiCoder.encode(
        ['address', 'address', 'uint256', 'uint128', 'uint128', 'bytes'],
        [ZERO_ADDRESS, bob.address, 0, 2, 0, '0x'],
      );
      await expect(
        swapper.swap(stETH.address, stablecoin.address, alice.address, parseEther('1'), parseEther('1'), data),
      ).to.be.reverted;
    });
    it('success - stETH available', async () => {
      await stETH.mint(swapper.address, parseEther('1'));
      await stablecoin.mint(router.address, parseEther('1'));
      let data = ethers.utils.defaultAbiCoder.encode(
        ['address', 'address', 'uint256', 'uint128', 'uint128', 'bytes'],
        [ZERO_ADDRESS, bob.address, 0, 2, 0, '0x'],
      );
      await swapper.swap(stETH.address, stablecoin.address, alice.address, parseEther('1'), parseEther('1'), data);
      expect(await stETH.balanceOf(router.address)).to.be.equal(parseEther('1'));
      expect(await stablecoin.balanceOf(alice.address)).to.be.equal(parseEther('1'));
      expect(await router.counterWrap()).to.be.equal(1);
    });
    it('reverts - too small amount', async () => {
      await stETH.mint(swapper.address, parseEther('1'));
      await stablecoin.mint(router.address, parseEther('1'));
      let data = ethers.utils.defaultAbiCoder.encode(
        ['address', 'address', 'uint256', 'uint128', 'uint128', 'bytes'],
        [ZERO_ADDRESS, bob.address, 0, 2, 0, '0x'],
      );
      await router.setStETHMultiplier(parseUnits('0.9', 9));
      await expect(
        swapper.swap(stETH.address, stablecoin.address, alice.address, parseEther('1'), parseEther('1'), data),
      ).to.be.revertedWith('52');
    });
    it('success - leftover amount', async () => {
      await stETH.mint(swapper.address, parseEther('1'));
      await stablecoin.mint(router.address, parseEther('1.1'));
      let data = ethers.utils.defaultAbiCoder.encode(
        ['address', 'address', 'uint256', 'uint128', 'uint128', 'bytes'],
        [ZERO_ADDRESS, bob.address, 0, 2, 0, '0x'],
      );
      await router.setStETHMultiplier(parseUnits('1.1', 9));
      await swapper.swap(stETH.address, stablecoin.address, alice.address, parseEther('1'), parseEther('1'), data);
      expect(await stETH.balanceOf(router.address)).to.be.equal(parseEther('1'));
      expect(await stablecoin.balanceOf(alice.address)).to.be.equal(parseEther('1'));
      expect(await stablecoin.balanceOf(bob.address)).to.be.equal(parseEther('0.1'));
    });
  });

  describe('swap - 1Inch', () => {
    it('reverts - nonexistent function', async () => {
      await collateral.mint(swapper.address, parseEther('1'));
      await stablecoin.mint(router.address, parseEther('1'));
      const payload1inch = web3.eth.abi.encodeFunctionCall(
        {
          name: 'nonexistentFct',
          type: 'function',
          inputs: [],
        },
        [],
      );
      let data = ethers.utils.defaultAbiCoder.encode(
        ['address', 'address', 'uint256', 'uint128', 'uint128', 'bytes'],
        [ZERO_ADDRESS, bob.address, 0, 1, 0, payload1inch],
      );
      await expect(
        swapper.swap(stETH.address, stablecoin.address, alice.address, parseEther('1'), parseEther('1'), data),
      ).to.be.revertedWith('53');
    });
    it('reverts - function reverts with message', async () => {
      await collateral.mint(swapper.address, parseEther('1'));
      await stablecoin.mint(router.address, parseEther('1'));
      const payload1inch = web3.eth.abi.encodeFunctionCall(
        {
          name: 'oneInchRevertsWithoutMessage',
          type: 'function',
          inputs: [],
        },
        [],
      );
      let data = ethers.utils.defaultAbiCoder.encode(
        ['address', 'address', 'uint256', 'uint128', 'uint128', 'bytes'],
        [ZERO_ADDRESS, bob.address, 0, 1, 0, payload1inch],
      );
      await expect(
        swapper.swap(stETH.address, stablecoin.address, alice.address, parseEther('1'), parseEther('1'), data),
      ).to.be.revertedWith('53');
    });
    it('reverts - 1Inch wrong revert message', async () => {
      await collateral.mint(swapper.address, parseEther('1'));
      await stablecoin.mint(router.address, parseEther('1'));
      const payload1inch = web3.eth.abi.encodeFunctionCall(
        {
          name: 'oneInchReverts',
          type: 'function',
          inputs: [],
        },
        [],
      );
      let data = ethers.utils.defaultAbiCoder.encode(
        ['address', 'address', 'uint256', 'uint128', 'uint128', 'bytes'],
        [ZERO_ADDRESS, bob.address, 0, 1, 0, payload1inch],
      );
      await expect(
        swapper.swap(stETH.address, stablecoin.address, alice.address, parseEther('1'), parseEther('1'), data),
      ).to.be.revertedWith('wrong swap');
    });
    it('success - correct amount out', async () => {
      await collateral.mint(swapper.address, parseEther('1'));
      await stablecoin.mint(router.address, parseEther('1'));
      const payload1inch = router.interface.encodeFunctionData('oneInch', [parseEther('1')]);
      let data = ethers.utils.defaultAbiCoder.encode(
        ['address', 'address', 'uint256', 'uint128', 'uint128', 'bytes'],
        [ZERO_ADDRESS, bob.address, 0, 1, 0, payload1inch],
      );
      await swapper.swap(collateral.address, stablecoin.address, alice.address, parseEther('1'), parseEther('1'), data);
      expect(await router.counter1Inch()).to.be.equal(1);
      expect(await swapper.oneInchAllowedToken(collateral.address)).to.be.equal(true);
      expect(await collateral.balanceOf(router.address)).to.be.equal(parseEther('1'));
      expect(await stablecoin.balanceOf(alice.address)).to.be.equal(parseEther('1'));
    });
    it('success - correct amount out twice', async () => {
      await collateral.mint(swapper.address, parseEther('2'));
      await stablecoin.mint(router.address, parseEther('2'));
      const payload1inch = router.interface.encodeFunctionData('oneInch', [parseEther('1')]);
      let data = ethers.utils.defaultAbiCoder.encode(
        ['address', 'address', 'uint256', 'uint128', 'uint128', 'bytes'],
        [ZERO_ADDRESS, bob.address, 0, 1, 0, payload1inch],
      );
      await swapper.swap(collateral.address, stablecoin.address, alice.address, parseEther('1'), parseEther('1'), data);
      await swapper.swap(collateral.address, stablecoin.address, alice.address, parseEther('1'), parseEther('1'), data);
      expect(await router.counter1Inch()).to.be.equal(2);
      expect(await swapper.oneInchAllowedToken(collateral.address)).to.be.equal(true);
      expect(await collateral.balanceOf(router.address)).to.be.equal(parseEther('2'));
      expect(await stablecoin.balanceOf(alice.address)).to.be.equal(parseEther('2'));
    });
    it('reverts - too small amount out', async () => {
      await collateral.mint(swapper.address, parseEther('1'));
      await stablecoin.mint(router.address, parseEther('1'));
      const payload1inch = router.interface.encodeFunctionData('oneInch', [parseEther('1')]);
      let data = ethers.utils.defaultAbiCoder.encode(
        ['address', 'address', 'uint256', 'uint128', 'uint128', 'bytes'],
        [ZERO_ADDRESS, bob.address, 0, 1, 0, payload1inch],
      );
      await router.setMultipliers(parseUnits('0.5', 9), parseUnits('1', 9));
      await expect(
        swapper.swap(collateral.address, stablecoin.address, alice.address, parseEther('1'), parseEther('1'), data),
      ).to.be.revertedWith('52');
    });
    it('success - leftover available amount out', async () => {
      await collateral.mint(swapper.address, parseEther('1'));
      await stablecoin.mint(router.address, parseEther('2'));
      const payload1inch = router.interface.encodeFunctionData('oneInch', [parseEther('1')]);
      let data = ethers.utils.defaultAbiCoder.encode(
        ['address', 'address', 'uint256', 'uint128', 'uint128', 'bytes'],
        [ZERO_ADDRESS, bob.address, 0, 1, 0, payload1inch],
      );
      await router.setMultipliers(parseUnits('2', 9), parseUnits('1', 9));
      await swapper.swap(collateral.address, stablecoin.address, alice.address, parseEther('1'), parseEther('1'), data);
      expect(await collateral.balanceOf(router.address)).to.be.equal(parseEther('1'));
      expect(await stablecoin.balanceOf(alice.address)).to.be.equal(parseEther('1'));
      expect(await stablecoin.balanceOf(bob.address)).to.be.equal(parseEther('1'));
    });
  });
  describe('changeAllowance', () => {
    it('reverts - non governor nor guardian', async () => {
      await expect(
        swapper.connect(deployer).changeAllowance([collateral.address], [router.address], [MAX_UINT256]),
      ).to.be.revertedWith('2');
    });
    it('reverts - incorrect length', async () => {
      await core.connect(alice).toggleGuardian(alice.address);
      await expect(swapper.connect(alice).changeAllowance([], [router.address], [MAX_UINT256])).to.be.revertedWith(
        '25',
      );
    });
    it('success - allowance increased on random token', async () => {
      await core.connect(alice).toggleGuardian(alice.address);
      await swapper.connect(alice).changeAllowance([collateral.address], [bob.address], [parseEther('3.33')]);
      expect(await collateral.allowance(swapper.address, bob.address)).to.be.equal(parseEther('3.33'));
    });
    it('success - allowance decreased on random token', async () => {
      await core.connect(alice).toggleGuardian(alice.address);
      await swapper.connect(alice).changeAllowance([collateral.address], [bob.address], [parseEther('3.33')]);
      await swapper.connect(alice).changeAllowance([collateral.address], [bob.address], [parseEther('2.33')]);
      expect(await collateral.allowance(swapper.address, bob.address)).to.be.equal(parseEther('2.33'));
    });
    it('success - allowance decreased and spender is uniV3', async () => {
      await core.connect(alice).toggleGuardian(alice.address);
      await collateral.mint(swapper.address, parseEther('1'));
      await stablecoin.mint(router.address, parseEther('1'));
      const data = ethers.utils.defaultAbiCoder.encode(
        ['address', 'address', 'uint256', 'uint128', 'uint128', 'bytes'],
        [ZERO_ADDRESS, bob.address, 0, 0, 0, '0x'],
      );
      await swapper.swap(collateral.address, stablecoin.address, alice.address, parseEther('1'), parseEther('1'), data);
      expect(await swapper.uniAllowedToken(collateral.address)).to.be.equal(true);
      expect(await collateral.allowance(swapper.address, router.address)).to.be.equal(MAX_UINT256.sub(parseEther('1')));
      await swapper.connect(alice).changeAllowance([collateral.address], [router.address], [parseEther('0.5')]);
      expect(await swapper.uniAllowedToken(collateral.address)).to.be.equal(false);
      expect(await collateral.allowance(swapper.address, router.address)).to.be.equal(parseEther('0.5'));
    });
    it('success - allowance decreased and spender is oneInch', async () => {
      await core.connect(alice).toggleGuardian(alice.address);
      const router2 = (await new MockRouter__factory(deployer).deploy()) as MockRouter;
      swapper = (await new Swapper__factory(deployer).deploy(
        core.address,
        router.address,
        router.address,
        router2.address,
        router.address,
      )) as Swapper;
      await swapper.connect(alice).changeAllowance([collateral.address], [router2.address], [parseEther('1')]);
      expect(await collateral.allowance(swapper.address, router2.address)).to.be.equal(parseEther('1'));
      await swapper.connect(alice).changeAllowance([collateral.address], [router2.address], [parseEther('0.5')]);
      expect(await swapper.oneInchAllowedToken(collateral.address)).to.be.equal(false);
      expect(await collateral.allowance(swapper.address, router2.address)).to.be.equal(parseEther('0.5'));
    });
    it('success - allowance decreased and spender is angleRouter', async () => {
      await core.connect(alice).toggleGuardian(alice.address);
      const router2 = (await new MockRouter__factory(deployer).deploy()) as MockRouter;
      swapper = (await new Swapper__factory(deployer).deploy(
        core.address,
        router.address,
        router.address,
        router.address,
        router2.address,
      )) as Swapper;
      await swapper.connect(alice).changeAllowance([collateral.address], [router2.address], [parseEther('1')]);
      expect(await collateral.allowance(swapper.address, router2.address)).to.be.equal(parseEther('1'));
      await swapper.connect(alice).changeAllowance([collateral.address], [router2.address], [parseEther('0.5')]);
      expect(await swapper.oneInchAllowedToken(collateral.address)).to.be.equal(false);
      expect(await collateral.allowance(swapper.address, router2.address)).to.be.equal(parseEther('0.5'));
    });
    it('success - allowance increased on some tokens and decreased on other', async () => {
      await core.connect(alice).toggleGuardian(alice.address);
      await swapper
        .connect(alice)
        .changeAllowance(
          [collateral.address, stablecoin.address, stETH.address],
          [bob.address, alice.address, deployer.address],
          [parseEther('1'), parseEther('1'), parseEther('1')],
        );
      expect(await collateral.allowance(swapper.address, bob.address)).to.be.equal(parseEther('1'));
      expect(await stablecoin.allowance(swapper.address, alice.address)).to.be.equal(parseEther('1'));
      expect(await stETH.allowance(swapper.address, deployer.address)).to.be.equal(parseEther('1'));
      await swapper
        .connect(alice)
        .changeAllowance(
          [collateral.address, stablecoin.address, stETH.address],
          [bob.address, alice.address, deployer.address],
          [parseEther('0.9'), parseEther('1'), parseEther('1.1')],
        );
      expect(await collateral.allowance(swapper.address, bob.address)).to.be.equal(parseEther('0.9'));
      expect(await stablecoin.allowance(swapper.address, alice.address)).to.be.equal(parseEther('1'));
      expect(await stETH.allowance(swapper.address, deployer.address)).to.be.equal(parseEther('1.1'));
    });
  });
});
