import { CONTRACTS_ADDRESSES } from '@angleprotocol/sdk';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BigNumber, Signer, utils } from 'ethers';
import { parseEther } from 'ethers/lib/utils';
import hre, { contract, ethers, web3 } from 'hardhat';
import { Address } from 'hardhat-deploy/dist/types';
import { inReceipt, inIndirectReceipt } from '../utils/expectEvent';
import { parseAmount } from '../../utils/bignumber';

import {
  FlashAngle,
  FlashAngle__factory,
  MockTreasury,
  MockTreasury__factory,
  MockCoreBorrow,
  MockCoreBorrow__factory,
  MockFlashLoanModule__factory,
  MockToken,
  MockToken__factory,
  MockFlashLoanReceiver,
  MockFlashLoanReceiver__factory,
} from '../../typechain';
import { expect } from '../utils/chai-setup';
import { deployUpgradeable, ZERO_ADDRESS } from '../utils/helpers';

contract('FlashAngle', () => {
  let deployer: SignerWithAddress;
  let user: SignerWithAddress;
  let user2: SignerWithAddress;

  let flashAngle: FlashAngle;
  let coreBorrow: MockCoreBorrow;
  let token: MockToken;
  let treasury: MockTreasury;
  let flashLoanReceiver: MockFlashLoanReceiver;
  let governor: string;
  let guardian: string;

  const impersonatedSigners: { [key: string]: Signer } = {};

  before(async () => {
    [deployer, user, user2] = await ethers.getSigners();
    // add any addresses you want to impersonate here
    governor = '0xdC4e6DFe07EFCa50a197DF15D9200883eF4Eb1c8';
    guardian = '0x0C2553e4B9dFA9f83b1A6D3EAB96c4bAaB42d430';
    const impersonatedAddresses = [governor, guardian];

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
    coreBorrow = (await new MockCoreBorrow__factory(deployer).deploy()) as MockCoreBorrow;
    flashLoanReceiver = (await new MockFlashLoanReceiver__factory(deployer).deploy()) as MockFlashLoanReceiver;

    token = (await new MockToken__factory(deployer).deploy('agEUR', 'agEUR', 18)) as MockToken;

    treasury = (await new MockTreasury__factory(deployer).deploy(
      token.address,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
    )) as MockTreasury;
    flashAngle = (await deployUpgradeable(new FlashAngle__factory(deployer))) as FlashAngle;
    await flashAngle.initialize(coreBorrow.address);

    await coreBorrow.addStablecoinSupport(flashAngle.address, treasury.address);
    await coreBorrow.toggleGovernor(governor);
    await coreBorrow.toggleGuardian(governor);
  });

  describe('initializer', () => {
    it('success - core initialized', async () => {
      expect(await flashAngle.core()).to.be.equal(coreBorrow.address);
      expect(await treasury.stablecoin()).to.be.equal(token.address);
      expect((await flashAngle.stablecoinMap(token.address)).treasury).to.be.equal(treasury.address);
      expect((await flashAngle.stablecoinMap(token.address)).maxBorrowable).to.be.equal(0);
      expect((await flashAngle.stablecoinMap(token.address)).flashLoanFee).to.be.equal(0);
    });
    it('reverts - already initialized', async () => {
      await expect(flashAngle.initialize(governor)).to.be.revertedWith(
        'Initializable: contract is already initialized',
      );
    });
    it('reverts - zero address', async () => {
      flashAngle = (await deployUpgradeable(new FlashAngle__factory(deployer))) as FlashAngle;
      await expect(flashAngle.initialize(ZERO_ADDRESS)).to.be.reverted;
    });
  });
  describe('addStablecoinSupport', () => {
    it('reverts - nonCore', async () => {
      await expect(flashAngle.addStablecoinSupport(guardian)).to.be.revertedWith('10');
    });
    it('success - stablecoinSupported', async () => {
      treasury = (await new MockTreasury__factory(deployer).deploy(
        guardian,
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        ZERO_ADDRESS,
      )) as MockTreasury;
      await coreBorrow.addStablecoinSupport(flashAngle.address, treasury.address);
      expect((await flashAngle.stablecoinMap(guardian)).treasury).to.be.equal(treasury.address);
      expect((await flashAngle.stablecoinMap(guardian)).maxBorrowable).to.be.equal(0);
      expect((await flashAngle.stablecoinMap(guardian)).flashLoanFee).to.be.equal(0);
    });
  });
  describe('removeStablecoinSupport', () => {
    it('reverts - nonCore', async () => {
      await expect(flashAngle.removeStablecoinSupport(treasury.address)).to.be.revertedWith('10');
    });
    it('success - stablecoin removed', async () => {
      await coreBorrow.removeStablecoinSupport(flashAngle.address, treasury.address);
      expect((await flashAngle.stablecoinMap(token.address)).treasury).to.be.equal(ZERO_ADDRESS);
      expect((await flashAngle.stablecoinMap(token.address)).maxBorrowable).to.be.equal(0);
      expect((await flashAngle.stablecoinMap(token.address)).flashLoanFee).to.be.equal(0);
    });
  });
  describe('setCore', () => {
    it('reverts - nonCore', async () => {
      await expect(flashAngle.setCore(treasury.address)).to.be.revertedWith('10');
    });
    it('success - core updated', async () => {
      await coreBorrow.setCore(flashAngle.address, treasury.address);
      expect(await flashAngle.core()).to.be.equal(treasury.address);
    });
  });
  describe('setFlashLoanParameters', () => {
    it('reverts - non existing stablecoin', async () => {
      await expect(flashAngle.setFlashLoanParameters(ZERO_ADDRESS, 0, 0)).to.be.revertedWith('13');
    });
    it('reverts - non governor', async () => {
      await expect(flashAngle.setFlashLoanParameters(token.address, 0, 0)).to.be.revertedWith('2');
    });
    it('reverts - too high fee', async () => {
      await expect(
        flashAngle.connect(impersonatedSigners[governor]).setFlashLoanParameters(token.address, parseEther('1'), 0),
      ).to.be.revertedWith('9');
    });
    it('success - parameters updated', async () => {
      await flashAngle
        .connect(impersonatedSigners[governor])
        .setFlashLoanParameters(token.address, parseAmount.gwei(0.5), parseEther('100'));
      expect((await flashAngle.stablecoinMap(token.address)).maxBorrowable).to.be.equal(parseEther('100'));
      expect((await flashAngle.stablecoinMap(token.address)).flashLoanFee).to.be.equal(parseAmount.gwei(0.5));
    });
  });
  describe('flashFee', () => {
    it('reverts - non existing stablecoin', async () => {
      await expect(flashAngle.flashFee(guardian, 0)).to.be.revertedWith('13');
    });
    it('success - supported token and null flash fee', async () => {
      expect(await flashAngle.flashFee(token.address, parseEther('1'))).to.be.equal(0);
    });
    it('success - supported token and non null flash fee', async () => {
      await flashAngle
        .connect(impersonatedSigners[governor])
        .setFlashLoanParameters(token.address, parseAmount.gwei(0.5), parseEther('100'));
      expect(await flashAngle.flashFee(token.address, parseEther('1'))).to.be.equal(parseEther('0.5'));
    });
  });
  describe('maxFlashLoan', () => {
    it('success - O on non existing token', async () => {
      expect(await flashAngle.maxFlashLoan(guardian)).to.be.equal(0);
    });
    it('success - O on existing token but with uninitialized parameters', async () => {
      expect(await flashAngle.maxFlashLoan(token.address)).to.be.equal(0);
    });
    it('success - correct value with initialized parameters', async () => {
      await flashAngle
        .connect(impersonatedSigners[governor])
        .setFlashLoanParameters(token.address, parseAmount.gwei(0.5), parseEther('100'));
      expect(await flashAngle.maxFlashLoan(token.address)).to.be.equal(parseEther('100'));
    });
  });
  describe('accrueInterestToTreasury', () => {
    it('reverts - invalid stablecoin', async () => {
      await expect(flashAngle.accrueInterestToTreasury(guardian)).to.be.revertedWith('14');
    });
    it('reverts - valid stablecoin but invalid sender', async () => {
      await expect(flashAngle.connect(user).accrueInterestToTreasury(token.address)).to.be.revertedWith('14');
    });
    it('success - valid stablecoin and valid sender - zero balance', async () => {
      const receipt = await (await treasury.accrueInterestToTreasury(flashAngle.address)).wait();
      expect(await token.balanceOf(flashAngle.address)).to.be.equal(parseEther('0'));
      inIndirectReceipt(
        receipt,
        new utils.Interface(['event Transfer(address indexed from, address indexed to, uint256 value)']),
        'Transfer',
        {
          from: flashAngle.address,
          to: treasury.address,
          value: parseEther('0'),
        },
      );
    });
    it('success - non null balance', async () => {
      await token.mint(flashAngle.address, parseEther('100'));
      expect(await token.balanceOf(flashAngle.address)).to.be.equal(parseEther('100'));
      const receipt = await (await treasury.accrueInterestToTreasury(flashAngle.address)).wait();
      inIndirectReceipt(
        receipt,
        new utils.Interface(['event Transfer(address indexed from, address indexed to, uint256 value)']),
        'Transfer',
        {
          from: flashAngle.address,
          to: treasury.address,
          value: parseEther('100'),
        },
      );
      expect(await token.balanceOf(treasury.address)).to.be.equal(parseEther('100'));
      expect(await token.balanceOf(flashAngle.address)).to.be.equal(parseEther('0'));
    });
  });
  describe('flashLoan', () => {
    it('reverts - unsupported token', async () => {
      await expect(
        flashAngle.flashLoan(flashLoanReceiver.address, guardian, 0, web3.utils.keccak256('test')),
      ).to.be.revertedWith('13');
    });
    it('reverts - too high amount', async () => {
      await expect(
        flashAngle.flashLoan(flashLoanReceiver.address, token.address, parseEther('1'), web3.utils.keccak256('test')),
      ).to.be.revertedWith('4');
    });
  });
});