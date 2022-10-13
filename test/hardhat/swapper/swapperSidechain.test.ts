import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { parseEther, parseUnits } from 'ethers/lib/utils';
import { contract, ethers, web3 } from 'hardhat';

import {
  MockCoreBorrow,
  MockCoreBorrow__factory,
  MockRouter,
  MockRouter__factory,
  MockSwapperSidechain,
  MockSwapperSidechain__factory,
  MockToken,
  MockToken__factory,
} from '../../../typechain';
import { expect } from '../utils/chai-setup';
import { MAX_UINT256, ZERO_ADDRESS } from '../utils/helpers';

contract('Swapper', () => {
  let deployer: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  let swapper: MockSwapperSidechain;
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
    await router.setInOut(collateral.address, stablecoin.address);
    swapper = (await new MockSwapperSidechain__factory(deployer).deploy(
      core.address,
      router.address,
      router.address,
      router.address,
    )) as MockSwapperSidechain;
  });

  describe('constructor', () => {
    it('success - contract initialized', async () => {
      expect(await swapper.core()).to.be.equal(core.address);
      expect(await swapper.angleRouter()).to.be.equal(router.address);
      expect(await swapper.oneInch()).to.be.equal(router.address);
      expect(await swapper.uniV3Router()).to.be.equal(router.address);
    });
    it('reverts - zero address', async () => {
      await expect(
        new MockSwapperSidechain__factory(deployer).deploy(ZERO_ADDRESS, router.address, router.address, router.address),
      ).to.be.revertedWith('ZeroAddress');
      await expect(
        new MockSwapperSidechain__factory(deployer).deploy(core.address, ZERO_ADDRESS, router.address, router.address),
      ).to.be.revertedWith('ZeroAddress');
      await expect(
        new MockSwapperSidechain__factory(deployer).deploy(core.address, router.address, ZERO_ADDRESS, router.address),
      ).to.be.revertedWith('ZeroAddress');
      await expect(
        new MockSwapperSidechain__factory(deployer).deploy(core.address, router.address, router.address, ZERO_ADDRESS),
      ).to.be.revertedWith('ZeroAddress');
    });
  });
  describe('changeAllowance', () => {
    it('reverts - non governor nor guardian', async () => {
      await expect(
        swapper.connect(deployer).changeAllowance([collateral.address], [router.address], [MAX_UINT256]),
      ).to.be.revertedWith('NotGovernorOrGuardian');
    });
    it('reverts - incorrect length', async () => {
      await core.connect(alice).toggleGuardian(alice.address);
      await expect(swapper.connect(alice).changeAllowance([], [router.address], [MAX_UINT256])).to.be.revertedWith(
        'IncompatibleLengths',
      );
      await expect(swapper.connect(alice).changeAllowance([collateral.address], [], [MAX_UINT256])).to.be.revertedWith(
        'IncompatibleLengths',
      );
      await expect(
        swapper.connect(alice).changeAllowance([collateral.address], [router.address], []),
      ).to.be.revertedWith('IncompatibleLengths');
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
    it('success - allowance decreased and increased on random token', async () => {
      await core.connect(alice).toggleGuardian(alice.address);
      await swapper.connect(alice).changeAllowance([collateral.address], [bob.address], [parseEther('3.33')]);
      await swapper.connect(alice).changeAllowance([collateral.address], [bob.address], [parseEther('2.33')]);
      expect(await collateral.allowance(swapper.address, bob.address)).to.be.equal(parseEther('2.33'));
      await swapper.connect(alice).changeAllowance([collateral.address], [bob.address], [parseEther('2.33')]);
      expect(await collateral.allowance(swapper.address, bob.address)).to.be.equal(parseEther('2.33'));
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

  describe('swap - with nothing', () => {
    it('reverts - no swap but not enough obtained', async () => {
      await stETH.mint(swapper.address, parseEther('2'));
      await stablecoin.mint(swapper.address, parseEther('3'));
      const data = ethers.utils.defaultAbiCoder.encode(
        ['address', 'uint256', 'uint128', 'bytes'],
        [bob.address, parseEther('10'), 3, '0x'],
      );
      await expect(
        swapper.swap(stablecoin.address, stETH.address, alice.address, parseEther('1'), parseEther('2'), data),
      ).to.be.revertedWith('TooSmallAmountOut');
    });
    it('success - no swap and leftover tokens', async () => {
      await stETH.mint(swapper.address, parseEther('2'));
      await stablecoin.mint(swapper.address, parseEther('3'));
      const data = ethers.utils.defaultAbiCoder.encode(
        ['address', 'uint256', 'uint128', 'bytes'],
        [bob.address, 0, 3, '0x'],
      );
      await swapper.swap(stablecoin.address, stETH.address, alice.address, parseEther('1'), parseEther('2'), data);
      expect(await stablecoin.balanceOf(bob.address)).to.be.equal(parseEther('3'));
      expect(await stETH.balanceOf(bob.address)).to.be.equal(parseEther('1'));
      expect(await stETH.balanceOf(alice.address)).to.be.equal(parseEther('1'));
    });
    it('success - no swap and leftover tokens and the recipient has more than the balance needed', async () => {
      await stETH.mint(swapper.address, parseEther('2'));
      await stETH.mint(alice.address, parseEther('1'));
      await stablecoin.mint(swapper.address, parseEther('3'));
      const data = ethers.utils.defaultAbiCoder.encode(
        ['address', 'uint256', 'uint128', 'bytes'],
        [bob.address, 0, 3, '0x'],
      );

      await swapper.swap(stablecoin.address, stETH.address, alice.address, parseEther('1'), parseEther('2'), data);
      expect(await stablecoin.balanceOf(bob.address)).to.be.equal(parseEther('3'));
      expect(await stETH.balanceOf(bob.address)).to.be.equal(parseEther('2'));
      expect(await stETH.balanceOf(alice.address)).to.be.equal(parseEther('1'));
    });
    it('success - no swap and leftover tokens and the recipient has a bit less than the balance needed', async () => {
      await stETH.mint(swapper.address, parseEther('2'));
      await stETH.mint(alice.address, parseEther('0.5'));
      await stablecoin.mint(swapper.address, parseEther('3'));
      const data = ethers.utils.defaultAbiCoder.encode(
        ['address', 'uint256', 'uint128', 'bytes'],
        [bob.address, 0, 3, '0x'],
      );

      await swapper.swap(stablecoin.address, stETH.address, alice.address, parseEther('1'), parseEther('2'), data);
      expect(await stablecoin.balanceOf(bob.address)).to.be.equal(parseEther('3'));
      expect(await stETH.balanceOf(bob.address)).to.be.equal(parseEther('1.5'));
      expect(await stETH.balanceOf(alice.address)).to.be.equal(parseEther('1'));
    });
    it('success - no swap and leftover tokens and to address is the zero address', async () => {
      await stablecoin.mint(swapper.address, parseEther('3'));
      await stETH.mint(swapper.address, parseEther('2'));
      const data = ethers.utils.defaultAbiCoder.encode(
        ['address', 'uint256', 'uint128', 'bytes'],
        [ZERO_ADDRESS, 0, 3, '0x'],
      );

      await swapper.swap(stablecoin.address, stETH.address, alice.address, parseEther('1'), parseEther('2'), data);
      expect(await stablecoin.balanceOf(alice.address)).to.be.equal(parseEther('3'));
      expect(await stETH.balanceOf(alice.address)).to.be.equal(parseEther('2'));
    });
    it('success - no swap and leftover tokens and to address is the outToken recipient', async () => {
      await stablecoin.mint(swapper.address, parseEther('3'));
      await stETH.mint(swapper.address, parseEther('2'));
      const data = ethers.utils.defaultAbiCoder.encode(
        ['address', 'uint256', 'uint128', 'bytes'],
        [alice.address, 0, 3, '0x'],
      );

      await swapper.swap(stablecoin.address, stETH.address, alice.address, parseEther('1'), parseEther('2'), data);
      expect(await stablecoin.balanceOf(alice.address)).to.be.equal(parseEther('3'));
      expect(await stETH.balanceOf(alice.address)).to.be.equal(parseEther('2'));
    });
  });

  describe('swap - UniswapV3', () => {
    it('reverts - invalid balance', async () => {
      const data = ethers.utils.defaultAbiCoder.encode(
        ['address', 'uint256', 'uint128', 'bytes'],
        [bob.address, 0, 0, '0x'],
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
        ['address', 'uint256', 'uint128', 'bytes'],
        [bob.address, 0, 0, '0x'],
      );
      await swapper.swap(collateral.address, stablecoin.address, alice.address, parseEther('1'), parseEther('1'), data);
      expect(await router.counterUni()).to.be.equal(1);
      expect(await stablecoin.balanceOf(swapper.address)).to.be.equal(0);
      expect(await stablecoin.balanceOf(router.address)).to.be.equal(0);
      expect(await collateral.balanceOf(router.address)).to.be.equal(parseEther('1'));
      expect(await collateral.balanceOf(swapper.address)).to.be.equal(parseEther('0'));
      expect(await stablecoin.balanceOf(alice.address)).to.be.equal(parseEther('1'));
      expect(await collateral.balanceOf(alice.address)).to.be.equal(parseEther('0'));
      expect(await collateral.allowance(swapper.address, router.address)).to.be.equal(MAX_UINT256.sub(parseEther('1')));
    });
    it('success - simple data and to in the data is the zero address', async () => {
      await collateral.mint(swapper.address, parseEther('1'));
      await stablecoin.mint(router.address, parseEther('1'));
      const data = ethers.utils.defaultAbiCoder.encode(
        ['address', 'uint256', 'uint128', 'bytes'],
        [ZERO_ADDRESS, 0, 0, '0x'],
      );
      await swapper.swap(collateral.address, stablecoin.address, alice.address, parseEther('1'), parseEther('1'), data);
      expect(await router.counterUni()).to.be.equal(1);
      expect(await stablecoin.balanceOf(swapper.address)).to.be.equal(0);
      expect(await stablecoin.balanceOf(router.address)).to.be.equal(0);
      expect(await collateral.balanceOf(router.address)).to.be.equal(parseEther('1'));
      expect(await collateral.balanceOf(swapper.address)).to.be.equal(parseEther('0'));
      expect(await stablecoin.balanceOf(alice.address)).to.be.equal(parseEther('1'));
      expect(await collateral.balanceOf(alice.address)).to.be.equal(parseEther('0'));
      expect(await collateral.allowance(swapper.address, router.address)).to.be.equal(MAX_UINT256.sub(parseEther('1')));
    });

    it('success - simple data but with an allowance already given and more collateral obtained 1/3 - to!=recipient', async () => {
      await collateral.mint(swapper.address, parseEther('1'));
      await stablecoin.mint(router.address, parseEther('3'));
      const data = ethers.utils.defaultAbiCoder.encode(
        ['address', 'uint256', 'uint128', 'bytes'],
        [bob.address, 0, 0, '0x'],
      );
      await swapper.swap(collateral.address, stablecoin.address, alice.address, parseEther('1'), parseEther('1'), data);
      await router.setMultipliers(parseUnits('1.5', 9), parseUnits('1', 9));
      await collateral.mint(swapper.address, parseEther('1'));
      // In this case the `to` address already has everything in balance so all stablecoin will be going to the
      // `bob` address
      await swapper.swap(collateral.address, stablecoin.address, alice.address, parseEther('1'), parseEther('1'), data);
      expect(await router.counterUni()).to.be.equal(2);
      expect(await stablecoin.balanceOf(swapper.address)).to.be.equal(0);
      expect(await stablecoin.balanceOf(router.address)).to.be.equal(parseEther('0.5'));
      expect(await collateral.balanceOf(router.address)).to.be.equal(parseEther('2'));
      expect(await collateral.balanceOf(swapper.address)).to.be.equal(parseEther('0'));
      expect(await stablecoin.balanceOf(alice.address)).to.be.equal(parseEther('1'));
      expect(await stablecoin.balanceOf(bob.address)).to.be.equal(parseEther('1.5'));
      expect(await collateral.balanceOf(alice.address)).to.be.equal(parseEther('0'));
      expect(await collateral.allowance(swapper.address, router.address)).to.be.equal(MAX_UINT256.sub(parseEther('2')));
    });
    it('success - simple data but with an allowance already given and more collateral obtained 2/3 - to = zero address', async () => {
      await collateral.mint(swapper.address, parseEther('1'));
      await stablecoin.mint(router.address, parseEther('3'));
      const data = ethers.utils.defaultAbiCoder.encode(
        ['address', 'uint256', 'uint128', 'bytes'],
        [ZERO_ADDRESS, 0, 0, '0x'],
      );
      await swapper.swap(collateral.address, stablecoin.address, alice.address, parseEther('1'), parseEther('1'), data);
      await router.setMultipliers(parseUnits('1.5', 9), parseUnits('1', 9));
      await collateral.mint(swapper.address, parseEther('1'));
      await swapper.swap(collateral.address, stablecoin.address, alice.address, parseEther('1'), parseEther('1'), data);
      expect(await router.counterUni()).to.be.equal(2);
      expect(await stablecoin.balanceOf(swapper.address)).to.be.equal(0);
      expect(await stablecoin.balanceOf(router.address)).to.be.equal(parseEther('0.5'));
      expect(await collateral.balanceOf(router.address)).to.be.equal(parseEther('2'));
      expect(await collateral.balanceOf(swapper.address)).to.be.equal(parseEther('0'));
      expect(await stablecoin.balanceOf(alice.address)).to.be.equal(parseEther('2.5'));
      expect(await collateral.balanceOf(alice.address)).to.be.equal(parseEther('0'));
      expect(await collateral.allowance(swapper.address, router.address)).to.be.equal(MAX_UINT256.sub(parseEther('2')));
    });
    it('success - simple data but with an allowance already given and more collateral obtained 3/3 - just enough collat obtained', async () => {
      await collateral.mint(swapper.address, parseEther('1'));
      await stablecoin.mint(router.address, parseEther('3'));
      const data = ethers.utils.defaultAbiCoder.encode(
        ['address', 'uint256', 'uint128', 'bytes'],
        [ZERO_ADDRESS, 0, 0, '0x'],
      );
      await swapper.swap(collateral.address, stablecoin.address, alice.address, parseEther('1'), parseEther('1'), data);
      await router.setMultipliers(parseUnits('1.5', 9), parseUnits('1', 9));
      await collateral.mint(swapper.address, parseEther('1'));
      await swapper.swap(
        collateral.address,
        stablecoin.address,
        alice.address,
        parseEther('2.5'),
        parseEther('1'),
        data,
      );
      expect(await router.counterUni()).to.be.equal(2);
      expect(await stablecoin.balanceOf(swapper.address)).to.be.equal(0);
      expect(await stablecoin.balanceOf(router.address)).to.be.equal(parseEther('0.5'));
      expect(await collateral.balanceOf(router.address)).to.be.equal(parseEther('2'));
      expect(await collateral.balanceOf(swapper.address)).to.be.equal(parseEther('0'));
      expect(await stablecoin.balanceOf(alice.address)).to.be.equal(parseEther('2.5'));
      expect(await collateral.balanceOf(alice.address)).to.be.equal(parseEther('0'));
      expect(await collateral.allowance(swapper.address, router.address)).to.be.equal(MAX_UINT256.sub(parseEther('2')));
    });
    it('reverts - too small amount obtained from Uniswap', async () => {
      await collateral.mint(swapper.address, parseEther('2'));
      await stablecoin.mint(router.address, parseEther('3'));
      const data = ethers.utils.defaultAbiCoder.encode(
        ['address', 'uint256', 'uint128', 'bytes'],
        [bob.address, parseEther('10'), 0, '0x'],
      );
      await expect(
        swapper.swap(collateral.address, stablecoin.address, alice.address, parseEther('1'), parseEther('1'), data),
      ).to.be.revertedWith('TooSmallAmountOut');
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
      const data = ethers.utils.defaultAbiCoder.encode(
        ['address', 'uint256', 'uint128', 'bytes'],
        [bob.address, 0, 1, payload1inch],
      );
      await expect(
        swapper.swap(stETH.address, stablecoin.address, alice.address, parseEther('1'), parseEther('1'), data),
      ).to.be.revertedWith('EmptyReturnMessage');
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
      const data = ethers.utils.defaultAbiCoder.encode(
        ['address', 'uint256', 'uint128', 'bytes'],
        [bob.address, 0, 1, payload1inch],
      );
      await expect(
        swapper.swap(stETH.address, stablecoin.address, alice.address, parseEther('1'), parseEther('1'), data),
      ).to.be.revertedWith('EmptyReturnMessage');
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
      const data = ethers.utils.defaultAbiCoder.encode(
        ['address', 'uint256', 'uint128', 'bytes'],
        [bob.address, 0, 1, payload1inch],
      );
      await expect(
        swapper.swap(stETH.address, stablecoin.address, alice.address, parseEther('1'), parseEther('1'), data),
      ).to.be.revertedWith('wrong swap');
    });
    it('success - correct amount out', async () => {
      await collateral.mint(swapper.address, parseEther('1'));
      await stablecoin.mint(router.address, parseEther('1'));
      const payload1inch = router.interface.encodeFunctionData('oneInch', [parseEther('1')]);
      const data = ethers.utils.defaultAbiCoder.encode(
        ['address', 'uint256', 'uint128', 'bytes'],
        [bob.address, 0, 1, payload1inch],
      );
      await swapper.swap(collateral.address, stablecoin.address, alice.address, parseEther('1'), parseEther('1'), data);
      expect(await router.counter1Inch()).to.be.equal(1);
      expect(await collateral.balanceOf(router.address)).to.be.equal(parseEther('1'));
      expect(await stablecoin.balanceOf(alice.address)).to.be.equal(parseEther('1'));
    });
    it('success - correct amount out twice 1/3', async () => {
      await collateral.mint(swapper.address, parseEther('1'));
      await stablecoin.mint(router.address, parseEther('2'));
      const payload1inch = router.interface.encodeFunctionData('oneInch', [parseEther('1')]);
      const data = ethers.utils.defaultAbiCoder.encode(
        ['address', 'uint256', 'uint128', 'bytes'],
        [ZERO_ADDRESS, 0, 1, payload1inch],
      );
      await swapper.swap(collateral.address, stablecoin.address, alice.address, parseEther('1'), parseEther('1'), data);
      await collateral.mint(swapper.address, parseEther('1'));
      await swapper.swap(collateral.address, stablecoin.address, alice.address, parseEther('1'), parseEther('1'), data);
      expect(await router.counter1Inch()).to.be.equal(2);
      expect(await collateral.balanceOf(router.address)).to.be.equal(parseEther('2'));
      expect(await stablecoin.balanceOf(alice.address)).to.be.equal(parseEther('2'));
    });
    it('success - correct amount out twice 2/3', async () => {
      await collateral.mint(swapper.address, parseEther('1'));
      await stablecoin.mint(router.address, parseEther('2'));
      const payload1inch = router.interface.encodeFunctionData('oneInch', [parseEther('1')]);
      const data = ethers.utils.defaultAbiCoder.encode(
        ['address', 'uint256', 'uint128', 'bytes'],
        [bob.address, 0, 1, payload1inch],
      );
      await swapper.swap(collateral.address, stablecoin.address, alice.address, parseEther('1'), parseEther('1'), data);
      await collateral.mint(swapper.address, parseEther('1'));
      await swapper.swap(collateral.address, stablecoin.address, alice.address, parseEther('2'), parseEther('1'), data);
      expect(await router.counter1Inch()).to.be.equal(2);
      expect(await collateral.balanceOf(router.address)).to.be.equal(parseEther('2'));
      expect(await stablecoin.balanceOf(alice.address)).to.be.equal(parseEther('2'));
    });
    it('success - correct amount out twice 3/3', async () => {
      await collateral.mint(swapper.address, parseEther('1'));
      await stablecoin.mint(router.address, parseEther('2'));
      const payload1inch = router.interface.encodeFunctionData('oneInch', [parseEther('1')]);
      const data = ethers.utils.defaultAbiCoder.encode(
        ['address', 'uint256', 'uint128', 'bytes'],
        [bob.address, 0, 1, payload1inch],
      );
      await swapper.swap(collateral.address, stablecoin.address, alice.address, parseEther('1'), parseEther('1'), data);
      await collateral.mint(swapper.address, parseEther('1'));
      await swapper.swap(collateral.address, stablecoin.address, alice.address, parseEther('1'), parseEther('1'), data);
      expect(await router.counter1Inch()).to.be.equal(2);
      expect(await collateral.balanceOf(router.address)).to.be.equal(parseEther('2'));
      expect(await stablecoin.balanceOf(alice.address)).to.be.equal(parseEther('1'));
      expect(await stablecoin.balanceOf(bob.address)).to.be.equal(parseEther('1'));
    });
    it('reverts - too small amount out', async () => {
      await collateral.mint(swapper.address, parseEther('1'));
      await stablecoin.mint(router.address, parseEther('1'));
      const payload1inch = router.interface.encodeFunctionData('oneInch', [parseEther('1')]);
      const data = ethers.utils.defaultAbiCoder.encode(
        ['address', 'uint256', 'uint128', 'bytes'],
        [bob.address, 0, 1, payload1inch],
      );
      await router.setMultipliers(parseUnits('0.5', 9), parseUnits('1', 9));
      await expect(
        swapper.swap(collateral.address, stablecoin.address, alice.address, parseEther('1'), parseEther('1'), data),
      ).to.be.reverted;
    });
    it('reverts - too small amount out and slippage check catches the failure', async () => {
      await collateral.mint(swapper.address, parseEther('1'));
      await stablecoin.mint(router.address, parseEther('1'));
      const payload1inch = router.interface.encodeFunctionData('oneInch', [parseEther('1')]);
      const data = ethers.utils.defaultAbiCoder.encode(
        ['address', 'uint256', 'uint128', 'bytes'],
        [bob.address, parseEther('1'), 1, payload1inch],
      );
      await router.setMultipliers(parseUnits('0.5', 9), parseUnits('1', 9));
      await expect(
        swapper.swap(collateral.address, stablecoin.address, alice.address, parseEther('1'), parseEther('1'), data),
      ).to.be.revertedWith('TooSmallAmountOut');
    });
    it('success - leftover available amount out', async () => {
      await collateral.mint(swapper.address, parseEther('1'));
      await stablecoin.mint(router.address, parseEther('2'));
      const payload1inch = router.interface.encodeFunctionData('oneInch', [parseEther('1')]);
      const data = ethers.utils.defaultAbiCoder.encode(
        ['address', 'uint256', 'uint128', 'bytes'],
        [bob.address, 0, 1, payload1inch],
      );
      await router.setMultipliers(parseUnits('2', 9), parseUnits('1', 9));
      await swapper.swap(collateral.address, stablecoin.address, alice.address, parseEther('1'), parseEther('1'), data);
      expect(await collateral.balanceOf(router.address)).to.be.equal(parseEther('1'));
      expect(await stablecoin.balanceOf(alice.address)).to.be.equal(parseEther('1'));
      expect(await stablecoin.balanceOf(bob.address)).to.be.equal(parseEther('1'));
    });
  });

  describe('swap - angleRouter', () => {
    it('success - correct amount out', async () => {
      await collateral.mint(swapper.address, parseEther('1'));
      await stablecoin.mint(swapper.address, parseEther('1'));
      const routerData = ethers.utils.defaultAbiCoder.encode(['uint128[]', 'bytes[]'], [[], []]);
      const data = ethers.utils.defaultAbiCoder.encode(
        ['address', 'uint256', 'uint128', 'bytes'],
        [bob.address, 0, 2, routerData],
      );
      await swapper.swap(collateral.address, stablecoin.address, alice.address, parseEther('1'), parseEther('1'), data);
      expect(await router.counterMixer()).to.be.equal(1);
      expect(await collateral.balanceOf(bob.address)).to.be.equal(parseEther('1'));
      expect(await stablecoin.balanceOf(alice.address)).to.be.equal(parseEther('1'));
    });
    it('success - when there is a token transfer between both contracts', async () => {
      await collateral.mint(swapper.address, parseEther('1'));
      await stablecoin.mint(swapper.address, parseEther('1'));
      await core.connect(alice).toggleGuardian(alice.address);
      const transferData = ethers.utils.defaultAbiCoder.encode(
        ['address', 'uint256'],
        [collateral.address, parseEther('1')],
      );
      const routerData = ethers.utils.defaultAbiCoder.encode(['uint128[]', 'bytes[]'], [[0], [transferData]]);
      const data = ethers.utils.defaultAbiCoder.encode(
        ['address', 'uint256', 'uint128', 'bytes'],
        [bob.address, 0, 2, routerData],
      );
      await swapper.swap(
        collateral.address,
        stablecoin.address,
        alice.address,
        parseEther('0.7'),
        parseEther('1'),
        data,
      );
      expect(await router.counterMixer()).to.be.equal(1);
      expect(await collateral.allowance(swapper.address, router.address)).to.be.equal(MAX_UINT256.sub(parseEther('1')));
      expect(await collateral.balanceOf(router.address)).to.be.equal(parseEther('1'));
      expect(await collateral.balanceOf(swapper.address)).to.be.equal(parseEther('0'));
      expect(await stablecoin.balanceOf(alice.address)).to.be.equal(parseEther('0.7'));
      expect(await stablecoin.balanceOf(bob.address)).to.be.equal(parseEther('0.3'));
    });
  });
});
