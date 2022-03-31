import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { Signer, utils } from 'ethers';
import { parseEther } from 'ethers/lib/utils';
import hre, { contract, ethers } from 'hardhat';
import { parseAmount } from '../../utils/bignumber';

import {
  AgTokenSideChainMultiBridge,
  AgTokenSideChainMultiBridge__factory,
  MockTreasury,
  MockTreasury__factory,
  MockToken,
  MockToken__factory,
} from '../../typechain';
import { expect } from '../utils/chai-setup';
import { inIndirectReceipt, inReceipt } from '../utils/expectEvent';
import { deployUpgradeable, ZERO_ADDRESS } from '../utils/helpers';

contract('AgTokenSideChainMultiBridge', () => {
  let deployer: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  let agToken: AgTokenSideChainMultiBridge;
  let governor: string;
  let treasury: MockTreasury;
  let bridgeToken: MockToken;

  const impersonatedSigners: { [key: string]: Signer } = {};

  before(async () => {
    [deployer, alice, bob] = await ethers.getSigners();
    // add any addresses you want to impersonate here
    governor = '0xdC4e6DFe07EFCa50a197DF15D9200883eF4Eb1c8';
    const impersonatedAddresses = [governor];

    for (const address of impersonatedAddresses) {
      await hre.network.provider.request({
        method: 'hardhat_impersonateAccount',
        params: [address],
      });
      await hre.network.provider.send('hardhat_setBalance', [address, '0x10000000000000000000000000000']);
      impersonatedSigners[address] = await ethers.getSigner(address);
    }
  });

  beforeEach(async () => {
    // Example of upgradeable deployment - Default signer will be alice
    agToken = (await deployUpgradeable(
      new AgTokenSideChainMultiBridge__factory(deployer),
    )) as AgTokenSideChainMultiBridge;

    treasury = (await new MockTreasury__factory(deployer).deploy(
      agToken.address,
      // governor is deployer
      deployer.address,
      // guardian is bob
      bob.address,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
    )) as MockTreasury;

    await agToken.initialize('agEUR', 'agEUR', treasury.address);

    await treasury.addMinter(agToken.address, alice.address);
    await agToken.connect(alice).mint(alice.address, parseEther('1'));
    bridgeToken = (await new MockToken__factory(deployer).deploy('any-agEUR', 'any-agEUR', 18)) as MockToken;
    // adding bridge token
    await agToken.connect(deployer).addBridgeToken(bridgeToken.address, parseEther('10'), parseAmount.gwei(0.5), false);
  });

  describe('addBridgeToken', () => {
    it('success - token added', async () => {
      expect((await agToken.bridges(bridgeToken.address)).paused).to.be.equal(false);
      expect((await agToken.bridges(bridgeToken.address)).limit).to.be.equal(parseEther('10'));
      expect((await agToken.bridges(bridgeToken.address)).allowed).to.be.equal(true);
      expect((await agToken.bridges(bridgeToken.address)).fee).to.be.equal(parseAmount.gwei(0.5));
      expect(await agToken.bridgeTokensList(0)).to.be.equal(bridgeToken.address);
      expect((await agToken.allBridgeTokens())[0]).to.be.equal(bridgeToken.address);
    });
    it('reverts - non governor', async () => {
      await expect(
        agToken.connect(bob).addBridgeToken(bridgeToken.address, parseEther('1'), parseAmount.gwei(0.5), false),
      ).to.be.revertedWith('1');
    });
    it('reverts - too high parameter value', async () => {
      const bridgeToken2 = (await new MockToken__factory(deployer).deploy('any-agEUR', 'any-agEUR', 18)) as MockToken;
      await expect(
        agToken.connect(deployer).addBridgeToken(bridgeToken2.address, parseEther('1'), parseAmount.gwei(2), false),
      ).to.be.revertedWith('9');
    });
    it('reverts - zero address', async () => {
      await expect(
        agToken.connect(deployer).addBridgeToken(ZERO_ADDRESS, parseEther('1'), parseAmount.gwei(0.5), false),
      ).to.be.revertedWith('51');
    });
    it('reverts - already added', async () => {
      await expect(
        agToken.connect(deployer).addBridgeToken(bridgeToken.address, parseEther('1'), parseAmount.gwei(0.5), false),
      ).to.be.revertedWith('51');
    });
    it('success - second token added', async () => {
      const bridgeToken2 = (await new MockToken__factory(deployer).deploy(
        'synapse-agEUR',
        'synapse-agEUR',
        18,
      )) as MockToken;
      const receipt = await (
        await agToken
          .connect(deployer)
          .addBridgeToken(bridgeToken2.address, parseEther('100'), parseAmount.gwei(0.03), true)
      ).wait();
      inReceipt(receipt, 'BridgeTokenAdded', {
        bridgeToken: bridgeToken2.address,
        limit: parseEther('100'),
        fee: parseAmount.gwei(0.03),
        paused: true,
      });
      expect((await agToken.bridges(bridgeToken2.address)).paused).to.be.equal(true);
      expect((await agToken.bridges(bridgeToken2.address)).limit).to.be.equal(parseEther('100'));
      expect((await agToken.bridges(bridgeToken2.address)).allowed).to.be.equal(true);
      expect((await agToken.bridges(bridgeToken2.address)).fee).to.be.equal(parseAmount.gwei(0.03));
      expect(await agToken.bridgeTokensList(1)).to.be.equal(bridgeToken2.address);
      expect((await agToken.allBridgeTokens())[1]).to.be.equal(bridgeToken2.address);
    });
  });
  describe('removeBridgeToken', () => {
    it('reverts - non governor', async () => {
      await expect(agToken.connect(bob).removeBridgeToken(bridgeToken.address)).to.be.revertedWith('1');
    });
    it('reverts - non null balance', async () => {
      await bridgeToken.mint(agToken.address, parseEther('1'));
      await expect(agToken.connect(deployer).removeBridgeToken(bridgeToken.address)).to.be.revertedWith('54');
    });
    it('success - mappings updated when there is one token', async () => {
      const receipt = await (await agToken.connect(deployer).removeBridgeToken(bridgeToken.address)).wait();
      inReceipt(receipt, 'BridgeTokenRemoved', {
        bridgeToken: bridgeToken.address,
      });
      expect((await agToken.bridges(bridgeToken.address)).paused).to.be.equal(false);
      expect((await agToken.bridges(bridgeToken.address)).limit).to.be.equal(parseEther('0'));
      expect((await agToken.bridges(bridgeToken.address)).allowed).to.be.equal(false);
      expect((await agToken.bridges(bridgeToken.address)).fee).to.be.equal(parseAmount.gwei(0));
    });
    it('success - when there are two tokens and first one is removed', async () => {
      const bridgeToken2 = (await new MockToken__factory(deployer).deploy(
        'synapse-agEUR',
        'synapse-agEUR',
        18,
      )) as MockToken;
      await agToken
        .connect(deployer)
        .addBridgeToken(bridgeToken2.address, parseEther('100'), parseAmount.gwei(0.03), true);
      const receipt = await (await agToken.connect(deployer).removeBridgeToken(bridgeToken.address)).wait();
      inReceipt(receipt, 'BridgeTokenRemoved', {
        bridgeToken: bridgeToken.address,
      });
      expect((await agToken.bridges(bridgeToken.address)).paused).to.be.equal(false);
      expect((await agToken.bridges(bridgeToken.address)).limit).to.be.equal(parseEther('0'));
      expect((await agToken.bridges(bridgeToken.address)).allowed).to.be.equal(false);
      expect((await agToken.bridges(bridgeToken.address)).fee).to.be.equal(parseAmount.gwei(0));
      expect(await agToken.bridgeTokensList(0)).to.be.equal(bridgeToken2.address);
      expect((await agToken.allBridgeTokens())[0]).to.be.equal(bridgeToken2.address);
    });
    it('success - when there are two tokens and second one is removed', async () => {
      const bridgeToken2 = (await new MockToken__factory(deployer).deploy(
        'synapse-agEUR',
        'synapse-agEUR',
        18,
      )) as MockToken;
      await agToken
        .connect(deployer)
        .addBridgeToken(bridgeToken2.address, parseEther('100'), parseAmount.gwei(0.03), true);
      const receipt = await (await agToken.connect(deployer).removeBridgeToken(bridgeToken2.address)).wait();
      inReceipt(receipt, 'BridgeTokenRemoved', {
        bridgeToken: bridgeToken2.address,
      });
      expect((await agToken.bridges(bridgeToken2.address)).paused).to.be.equal(false);
      expect((await agToken.bridges(bridgeToken2.address)).limit).to.be.equal(parseEther('0'));
      expect((await agToken.bridges(bridgeToken2.address)).allowed).to.be.equal(false);
      expect((await agToken.bridges(bridgeToken2.address)).fee).to.be.equal(parseAmount.gwei(0));
      expect(await agToken.bridgeTokensList(0)).to.be.equal(bridgeToken.address);
      expect((await agToken.allBridgeTokens())[0]).to.be.equal(bridgeToken.address);
    });
  });
  describe('recoverERC20', () => {
    it('reverts - non governor', async () => {
      await expect(
        agToken.connect(bob).recoverERC20(bridgeToken.address, bob.address, parseEther('1')),
      ).to.be.revertedWith('1');
    });
    it('reverts - invalid balance', async () => {
      await expect(agToken.connect(deployer).recoverERC20(bridgeToken.address, bob.address, parseEther('1'))).to.be
        .reverted;
    });
    it('success - amount transfered', async () => {
      await bridgeToken.mint(agToken.address, parseEther('1'));
      expect(await bridgeToken.balanceOf(agToken.address)).to.be.equal(parseEther('1'));
      const receipt = await (
        await agToken.connect(deployer).recoverERC20(bridgeToken.address, bob.address, parseEther('1'))
      ).wait();
      expect(await bridgeToken.balanceOf(agToken.address)).to.be.equal(parseEther('0'));
      inReceipt(receipt, 'Recovered', {
        token: bridgeToken.address,
        to: bob.address,
        amount: parseEther('1'),
      });
    });
  });
  describe('setLimit', () => {
    it('reverts - non governor and non guardian', async () => {
      await expect(agToken.connect(alice).setLimit(bridgeToken.address, parseEther('1'))).to.be.revertedWith('2');
    });
    it('reverts - non allowed token', async () => {
      await expect(agToken.connect(deployer).setLimit(alice.address, parseEther('1'))).to.be.revertedWith('51');
    });
    it('success - value updated', async () => {
      const receipt = await (await agToken.connect(deployer).setLimit(bridgeToken.address, parseEther('1000'))).wait();
      inReceipt(receipt, 'BridgeTokenLimitUpdated', {
        bridgeToken: bridgeToken.address,
        limit: parseEther('1000'),
      });
      expect((await agToken.bridges(bridgeToken.address)).limit).to.be.equal(parseEther('1000'));
    });
  });
  describe('setSwapFee', () => {
    it('reverts - non governor and non guardian', async () => {
      await expect(agToken.connect(alice).setSwapFee(bridgeToken.address, parseAmount.gwei('0.5'))).to.be.revertedWith(
        '2',
      );
    });
    it('reverts - non allowed token', async () => {
      await expect(agToken.connect(deployer).setSwapFee(alice.address, parseAmount.gwei('0.5'))).to.be.revertedWith(
        '51',
      );
    });
    it('reverts - too high value', async () => {
      await expect(agToken.connect(deployer).setSwapFee(bridgeToken.address, parseAmount.gwei('2'))).to.be.revertedWith(
        '9',
      );
    });
    it('success - value updated', async () => {
      const receipt = await (
        await agToken.connect(deployer).setSwapFee(bridgeToken.address, parseAmount.gwei('0.001'))
      ).wait();
      inReceipt(receipt, 'BridgeTokenFeeUpdated', {
        bridgeToken: bridgeToken.address,
        fee: parseAmount.gwei('0.001'),
      });
      expect((await agToken.bridges(bridgeToken.address)).fee).to.be.equal(parseAmount.gwei('0.001'));
    });
  });
  describe('toggleBridge', () => {
    it('reverts - non governor and non guardian', async () => {
      await expect(agToken.connect(alice).toggleBridge(bridgeToken.address)).to.be.revertedWith('2');
    });
    it('reverts - non existing bridge', async () => {
      await expect(agToken.connect(deployer).toggleBridge(alice.address)).to.be.revertedWith('51');
    });
    it('success - bridge paused', async () => {
      const receipt = await (await agToken.connect(deployer).toggleBridge(bridgeToken.address)).wait();
      inReceipt(receipt, 'BridgeTokenToggled', {
        bridgeToken: bridgeToken.address,
        toggleStatus: true,
      });
      expect((await agToken.bridges(bridgeToken.address)).paused).to.be.equal(true);
    });
    it('success - bridge unpaused', async () => {
      await agToken.connect(deployer).toggleBridge(bridgeToken.address);
      const receipt = await (await agToken.connect(deployer).toggleBridge(bridgeToken.address)).wait();
      inReceipt(receipt, 'BridgeTokenToggled', {
        bridgeToken: bridgeToken.address,
        toggleStatus: false,
      });
      expect((await agToken.bridges(bridgeToken.address)).paused).to.be.equal(false);
    });
  });
  describe('toggleFeesForAddress', () => {
    it('reverts - non governor and non guardian', async () => {
      await expect(agToken.connect(alice).toggleFeesForAddress(bridgeToken.address)).to.be.revertedWith('2');
    });
    it('success - address exempted', async () => {
      const receipt = await (await agToken.connect(deployer).toggleFeesForAddress(alice.address)).wait();
      inReceipt(receipt, 'FeeToggled', {
        theAddress: alice.address,
        toggleStatus: true,
      });
      expect(await agToken.isFeeExempt(alice.address)).to.be.equal(true);
    });
    it('success - address unexempted', async () => {
      await agToken.connect(deployer).toggleFeesForAddress(alice.address);
      const receipt = await (await agToken.connect(deployer).toggleFeesForAddress(alice.address)).wait();
      inReceipt(receipt, 'FeeToggled', {
        theAddress: alice.address,
        toggleStatus: false,
      });
      expect(await agToken.isFeeExempt(alice.address)).to.be.equal(false);
    });
  });

  describe('swapIn', () => {
    it('reverts - incorrect bridge token', async () => {
      await expect(agToken.connect(deployer).swapIn(bob.address, parseEther('1'), alice.address)).to.be.revertedWith(
        '51',
      );
    });
    it('reverts - bridge token paused', async () => {
      await agToken.connect(deployer).toggleBridge(bridgeToken.address);
      await expect(
        agToken.connect(deployer).swapIn(bridgeToken.address, parseEther('1'), alice.address),
      ).to.be.revertedWith('51');
    });
    it('reverts - zero limit', async () => {
      await agToken.connect(deployer).setLimit(bridgeToken.address, parseEther('0'));
      await expect(
        agToken.connect(deployer).swapIn(bridgeToken.address, parseEther('1'), alice.address),
      ).to.be.revertedWith('4');
    });
    it('reverts - amount greater than limit', async () => {
      await agToken.connect(deployer).setLimit(bridgeToken.address, parseEther('10'));
      await expect(
        agToken.connect(deployer).swapIn(bridgeToken.address, parseEther('100'), alice.address),
      ).to.be.revertedWith('4');
    });
    it('reverts - insufficient balance or no approval', async () => {
      await agToken.connect(deployer).setLimit(bridgeToken.address, parseEther('100'));
      await bridgeToken.mint(deployer.address, parseEther('10'));
      await expect(agToken.connect(deployer).swapIn(bridgeToken.address, parseEther('50'), alice.address)).to.be
        .reverted;
      await bridgeToken.connect(deployer).approve(agToken.address, parseEther('100'));
      await expect(agToken.connect(deployer).swapIn(bridgeToken.address, parseEther('50'), alice.address)).to.be
        .reverted;
    });
    it('success - with some transaction fees', async () => {
      await agToken.connect(deployer).setSwapFee(bridgeToken.address, parseAmount.gwei('0.5'));
      await agToken.connect(deployer).setLimit(bridgeToken.address, parseEther('100'));
      await bridgeToken.mint(deployer.address, parseEther('10'));
      await bridgeToken.connect(deployer).approve(agToken.address, parseEther('10'));
      const receipt = await (
        await agToken.connect(deployer).swapIn(bridgeToken.address, parseEther('10'), bob.address)
      ).wait();
      expect(await bridgeToken.balanceOf(agToken.address)).to.be.equal(parseEther('10'));
      expect(await bridgeToken.balanceOf(deployer.address)).to.be.equal(parseEther('0'));
      expect(await agToken.balanceOf(bob.address)).to.be.equal(parseEther('5'));
      inIndirectReceipt(
        receipt,
        new utils.Interface(['event Transfer(address indexed from, address indexed to, uint256 value)']),
        'Transfer',
        {
          from: deployer.address,
          to: agToken.address,
          value: parseEther('10'),
        },
      );
    });
    it('success - with some transaction fees and exempt address', async () => {
      await agToken.connect(deployer).toggleFeesForAddress(deployer.address);
      await agToken.connect(deployer).setSwapFee(bridgeToken.address, parseAmount.gwei('0.5'));
      await agToken.connect(deployer).setLimit(bridgeToken.address, parseEther('100'));
      await bridgeToken.mint(deployer.address, parseEther('10'));
      await bridgeToken.connect(deployer).approve(agToken.address, parseEther('10'));
      const receipt = await (
        await agToken.connect(deployer).swapIn(bridgeToken.address, parseEther('10'), bob.address)
      ).wait();
      expect(await bridgeToken.balanceOf(agToken.address)).to.be.equal(parseEther('10'));
      expect(await bridgeToken.balanceOf(deployer.address)).to.be.equal(parseEther('0'));
      expect(await agToken.balanceOf(bob.address)).to.be.equal(parseEther('10'));
      inIndirectReceipt(
        receipt,
        new utils.Interface(['event Transfer(address indexed from, address indexed to, uint256 value)']),
        'Transfer',
        {
          from: deployer.address,
          to: agToken.address,
          value: parseEther('10'),
        },
      );
    });
    it('success - with no transaction fees and non exempt address', async () => {
      await agToken.connect(deployer).setSwapFee(bridgeToken.address, parseAmount.gwei('0'));
      await agToken.connect(deployer).setLimit(bridgeToken.address, parseEther('100'));
      await bridgeToken.mint(deployer.address, parseEther('10'));
      await bridgeToken.connect(deployer).approve(agToken.address, parseEther('10'));
      const receipt = await (
        await agToken.connect(deployer).swapIn(bridgeToken.address, parseEther('10'), bob.address)
      ).wait();
      expect(await bridgeToken.balanceOf(agToken.address)).to.be.equal(parseEther('10'));
      expect(await bridgeToken.balanceOf(deployer.address)).to.be.equal(parseEther('0'));
      expect(await agToken.balanceOf(bob.address)).to.be.equal(parseEther('10'));
      inIndirectReceipt(
        receipt,
        new utils.Interface(['event Transfer(address indexed from, address indexed to, uint256 value)']),
        'Transfer',
        {
          from: deployer.address,
          to: agToken.address,
          value: parseEther('10'),
        },
      );
    });
    it('success - with weird transaction fees', async () => {
      await agToken.connect(deployer).setSwapFee(bridgeToken.address, parseAmount.gwei('0.0004'));
      await agToken.connect(deployer).setLimit(bridgeToken.address, parseEther('100'));
      await bridgeToken.mint(deployer.address, parseEther('100'));
      await bridgeToken.connect(deployer).approve(agToken.address, parseEther('100'));
      const receipt = await (
        await agToken.connect(deployer).swapIn(bridgeToken.address, parseEther('100'), bob.address)
      ).wait();
      expect(await bridgeToken.balanceOf(agToken.address)).to.be.equal(parseEther('100'));
      expect(await bridgeToken.balanceOf(deployer.address)).to.be.equal(parseEther('0'));
      expect(await agToken.balanceOf(bob.address)).to.be.equal(parseEther('99.96'));
      inIndirectReceipt(
        receipt,
        new utils.Interface(['event Transfer(address indexed from, address indexed to, uint256 value)']),
        'Transfer',
        {
          from: deployer.address,
          to: agToken.address,
          value: parseEther('100'),
        },
      );
    });
  });
  describe('swapOut', () => {
    it('reverts - incorrect bridge token', async () => {
      await expect(agToken.connect(deployer).swapOut(bob.address, parseEther('1'), alice.address)).to.be.revertedWith(
        '51',
      );
    });
    it('reverts - bridge token paused', async () => {
      await agToken.connect(deployer).toggleBridge(bridgeToken.address);
      await expect(
        agToken.connect(deployer).swapOut(bridgeToken.address, parseEther('1'), alice.address),
      ).to.be.revertedWith('51');
    });
    it('reverts - invalid agToken balance', async () => {
      await expect(agToken.connect(deployer).swapOut(bridgeToken.address, parseEther('1'), alice.address)).to.be
        .reverted;
    });
    it('reverts - invalid bridgeToken balance', async () => {
      await agToken.connect(deployer).setSwapFee(bridgeToken.address, parseAmount.gwei('0.5'));
      await agToken.connect(alice).mint(deployer.address, parseEther('100'));
      await expect(agToken.connect(deployer).swapOut(bridgeToken.address, parseEther('1'), alice.address)).to.be
        .reverted;
    });
    it('success - with a valid bridgeToken balance', async () => {
      await agToken.connect(deployer).setSwapFee(bridgeToken.address, parseAmount.gwei('0.5'));
      await agToken.connect(alice).mint(deployer.address, parseEther('100'));
      await bridgeToken.connect(deployer).mint(agToken.address, parseEther('100'));
      await agToken.connect(deployer).swapOut(bridgeToken.address, parseEther('100'), bob.address);
      expect(await agToken.balanceOf(deployer.address)).to.be.equal(parseEther('0'));
      expect(await bridgeToken.balanceOf(bob.address)).to.be.equal(parseEther('50'));
      expect(await bridgeToken.balanceOf(deployer.address)).to.be.equal(parseEther('0'));
      expect(await bridgeToken.balanceOf(agToken.address)).to.be.equal(parseEther('50'));
    });
    it('success - with a valid bridgeToken balance but a fee exemption', async () => {
      await agToken.connect(deployer).toggleFeesForAddress(deployer.address);
      await agToken.connect(deployer).setSwapFee(bridgeToken.address, parseAmount.gwei('0.5'));
      await agToken.connect(alice).mint(deployer.address, parseEther('100'));
      await bridgeToken.connect(deployer).mint(agToken.address, parseEther('100'));
      const receipt = await (
        await agToken.connect(deployer).swapOut(bridgeToken.address, parseEther('100'), bob.address)
      ).wait();
      inIndirectReceipt(
        receipt,
        new utils.Interface(['event Transfer(address indexed from, address indexed to, uint256 value)']),
        'Transfer',
        {
          from: agToken.address,
          to: bob.address,
          value: parseEther('100'),
        },
      );
      expect(await agToken.balanceOf(deployer.address)).to.be.equal(parseEther('0'));
      expect(await bridgeToken.balanceOf(bob.address)).to.be.equal(parseEther('100'));
      expect(await bridgeToken.balanceOf(agToken.address)).to.be.equal(parseEther('0'));
      expect(await bridgeToken.balanceOf(deployer.address)).to.be.equal(parseEther('0'));
    });
    it('success - with weird transaction fees', async () => {
      await agToken.connect(deployer).setSwapFee(bridgeToken.address, parseAmount.gwei('0.0004'));
      await agToken.connect(alice).mint(deployer.address, parseEther('100'));
      await bridgeToken.connect(deployer).mint(agToken.address, parseEther('100'));
      await agToken.connect(deployer).swapOut(bridgeToken.address, parseEther('100'), bob.address);
      expect(await agToken.balanceOf(deployer.address)).to.be.equal(parseEther('0'));
      expect(await bridgeToken.balanceOf(bob.address)).to.be.equal(parseEther('99.96'));
      expect(await bridgeToken.balanceOf(deployer.address)).to.be.equal(parseEther('0'));
      expect(await bridgeToken.balanceOf(agToken.address)).to.be.equal(parseEther('0.04'));
    });
  });
});
