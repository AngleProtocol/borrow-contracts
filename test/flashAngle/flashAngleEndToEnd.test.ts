import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { Signer, utils } from 'ethers';
import { parseEther } from 'ethers/lib/utils';
import hre, { contract, ethers, web3 } from 'hardhat';

import {
  AgToken,
  AgToken__factory,
  CoreBorrow,
  CoreBorrow__factory,
  FlashAngle,
  FlashAngle__factory,
  MockFlashLoanReceiver,
  MockFlashLoanReceiver__factory,
  MockStableMaster,
  MockStableMaster__factory,
  Treasury,
  Treasury__factory,
} from '../../typechain';
import { parseAmount } from '../../utils/bignumber';
import { expect } from '../utils/chai-setup';
import { inIndirectReceipt, inReceipt } from '../utils/expectEvent';
import { deployUpgradeable, ZERO_ADDRESS } from '../utils/helpers';

contract('FlashAngle - End-to-end', () => {
  let deployer: SignerWithAddress;
  let alice: SignerWithAddress;

  let flashAngle: FlashAngle;
  let coreBorrow: CoreBorrow;
  let agToken: AgToken;
  let treasury: Treasury;
  let flashLoanReceiver: MockFlashLoanReceiver;
  let stableMaster: MockStableMaster;
  let governor: string;
  let guardian: string;

  const impersonatedSigners: { [key: string]: Signer } = {};

  before(async () => {
    [deployer, alice] = await ethers.getSigners();
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
    coreBorrow = (await deployUpgradeable(new CoreBorrow__factory(deployer))) as CoreBorrow;
    await coreBorrow.initialize(governor, guardian);
    flashAngle = (await deployUpgradeable(new FlashAngle__factory(deployer))) as FlashAngle;
    await flashAngle.initialize(coreBorrow.address);
    await coreBorrow.connect(impersonatedSigners[governor]).setFlashLoanModule(flashAngle.address);
    stableMaster = (await new MockStableMaster__factory(deployer).deploy()) as MockStableMaster;

    // Example of upgradeable deployment - Default signer will be user
    agToken = (await deployUpgradeable(new AgToken__factory(deployer))) as AgToken;
    await agToken.initialize('agEUR', 'agEUR', stableMaster.address);
    treasury = (await deployUpgradeable(new Treasury__factory(deployer))) as Treasury;
    await treasury.initialize(coreBorrow.address, agToken.address);

    await agToken.connect(impersonatedSigners[governor]).setUpTreasury(treasury.address);
    await coreBorrow.connect(impersonatedSigners[governor]).addFlashLoanerTreasuryRole(treasury.address);
    flashLoanReceiver = (await new MockFlashLoanReceiver__factory(deployer).deploy()) as MockFlashLoanReceiver;
  });

  describe('initializer', () => {
    it('success - flashAngle well initialized and addStablecoinSupport worked well', async () => {
      expect(await flashAngle.core()).to.be.equal(coreBorrow.address);
      expect(await treasury.stablecoin()).to.be.equal(agToken.address);
      expect(await coreBorrow.flashLoanModule()).to.be.equal(flashAngle.address);
      expect(await treasury.flashLoanModule()).to.be.equal(flashAngle.address);
      expect(await agToken.isMinter(flashAngle.address)).to.be.equal(true);
      expect((await flashAngle.stablecoinMap(agToken.address)).treasury).to.be.equal(treasury.address);
      expect((await flashAngle.stablecoinMap(agToken.address)).maxBorrowable).to.be.equal(0);
      expect((await flashAngle.stablecoinMap(agToken.address)).flashLoanFee).to.be.equal(0);
      await expect(flashAngle.initialize(governor)).to.be.revertedWith(
        'Initializable: contract is already initialized',
      );
    });
  });
  describe('removeStablecoinSupport', () => {
    it('success - core initialized', async () => {
      const receipt = await (
        await coreBorrow.connect(impersonatedSigners[governor]).removeFlashLoanerTreasuryRole(treasury.address)
      ).wait();
      expect((await flashAngle.stablecoinMap(agToken.address)).treasury).to.be.equal(ZERO_ADDRESS);
      expect(await treasury.flashLoanModule()).to.be.equal(ZERO_ADDRESS);
      expect(await agToken.isMinter(flashAngle.address)).to.be.equal(false);
      inReceipt(receipt, 'RoleRevoked', {
        role: web3.utils.keccak256('FLASHLOANER_TREASURY_ROLE'),
        account: treasury.address,
        sender: governor,
      });
    });
  });
  describe('setCore', () => {
    it('success - core initialized', async () => {
      const newCore = (await deployUpgradeable(new CoreBorrow__factory(deployer))) as CoreBorrow;
      await newCore.initialize(governor, guardian);
      const receipt = await (await coreBorrow.connect(impersonatedSigners[governor]).setCore(newCore.address)).wait();
      inReceipt(receipt, 'CoreUpdated', {
        _core: newCore.address,
      });
      expect(await flashAngle.core()).to.be.equal(newCore.address);
    });
  });
  describe('setFlashLoanParameters', () => {
    it('success - parameters updated', async () => {
      await flashAngle
        .connect(impersonatedSigners[guardian])
        .setFlashLoanParameters(agToken.address, parseAmount.gwei('0.5'), parseEther('100000'));
      expect((await flashAngle.stablecoinMap(agToken.address)).treasury).to.be.equal(treasury.address);
      expect((await flashAngle.stablecoinMap(agToken.address)).maxBorrowable).to.be.equal(parseEther('100000'));
      expect((await flashAngle.stablecoinMap(agToken.address)).flashLoanFee).to.be.equal(parseAmount.gwei('0.5'));
      expect(await flashAngle.flashFee(agToken.address, parseEther('1000'))).to.be.equal(parseEther('500'));
      expect(await flashAngle.maxFlashLoan(agToken.address)).to.be.equal(parseEther('100000'));
    });
  });
  describe('flashLoan', () => {
    it('success - fees accrued', async () => {
      await flashAngle
        .connect(impersonatedSigners[guardian])
        .setFlashLoanParameters(agToken.address, parseAmount.gwei('0.5'), parseEther('100000'));
      // Add Minter in the contract
      await treasury.connect(impersonatedSigners[governor]).addMinter(alice.address);
      await agToken.connect(alice).mint(flashLoanReceiver.address, parseEther('5'));
      expect(await agToken.balanceOf(flashAngle.address)).to.be.equal(parseEther('0'));
      expect(await agToken.balanceOf(flashLoanReceiver.address)).to.be.equal(parseEther('5'));
      expect(await agToken.isMinter(alice.address)).to.be.equal(true);
      const receipt = await (
        await flashAngle.flashLoan(
          flashLoanReceiver.address,
          agToken.address,
          parseEther('10'),
          web3.utils.keccak256('e2e'),
        )
      ).wait();
      expect(await agToken.balanceOf(flashAngle.address)).to.be.equal(parseEther('5'));
      expect(await agToken.balanceOf(flashLoanReceiver.address)).to.be.equal(parseEther('0'));
      inIndirectReceipt(
        receipt,
        new utils.Interface(['event Transfer(address indexed from, address indexed to, uint256 value)']),
        'Transfer',
        {
          from: ZERO_ADDRESS,
          to: flashLoanReceiver.address,
          value: parseEther('10'),
        },
      );
      inIndirectReceipt(
        receipt,
        new utils.Interface(['event Transfer(address indexed from, address indexed to, uint256 value)']),
        'Transfer',
        {
          from: flashLoanReceiver.address,
          to: flashAngle.address,
          value: parseEther('15'),
        },
      );
      inIndirectReceipt(
        receipt,
        new utils.Interface(['event Transfer(address indexed from, address indexed to, uint256 value)']),
        'Transfer',
        {
          from: flashAngle.address,
          to: ZERO_ADDRESS,
          value: parseEther('10'),
        },
      );
    });
    it('reverts - incorrect token, too high amount, insufficient balance', async () => {
      await expect(
        flashAngle.flashLoan(
          flashLoanReceiver.address,
          agToken.address,
          parseEther('10000000000'),
          web3.utils.keccak256('e2e'),
        ),
      ).to.be.revertedWith('TooBigAmount');
      await expect(
        flashAngle.flashLoan(
          flashLoanReceiver.address,
          alice.address,
          parseEther('10000000000'),
          web3.utils.keccak256('e2e'),
        ),
      ).to.be.revertedWith('UnsupportedStablecoin');
      await flashAngle
        .connect(impersonatedSigners[guardian])
        .setFlashLoanParameters(agToken.address, parseAmount.gwei('0.5'), parseEther('100000'));
      await treasury.connect(impersonatedSigners[governor]).addMinter(alice.address);
      await agToken.connect(alice).mint(flashLoanReceiver.address, parseEther('4'));
      await expect(
        flashAngle.flashLoan(flashLoanReceiver.address, agToken.address, parseEther('10'), web3.utils.keccak256('e2e')),
      ).to.be.reverted;
    });
  });
  describe('accrueInterestToTreasury', () => {
    it('success - fees transferred to treasury', async () => {
      // Setting up fee accumulation
      await flashAngle
        .connect(impersonatedSigners[guardian])
        .setFlashLoanParameters(agToken.address, parseAmount.gwei('0.5'), parseEther('100000'));
      // Add Minter in the contract
      await treasury.connect(impersonatedSigners[governor]).addMinter(alice.address);
      await agToken.connect(alice).mint(flashLoanReceiver.address, parseEther('5'));
      await flashAngle.flashLoan(
        flashLoanReceiver.address,
        agToken.address,
        parseEther('10'),
        web3.utils.keccak256('e2e'),
      );
      const receipt = await (await treasury.fetchSurplusFromFlashLoan()).wait();
      inIndirectReceipt(
        receipt,
        new utils.Interface(['event Transfer(address indexed from, address indexed to, uint256 value)']),
        'Transfer',
        {
          from: flashAngle.address,
          to: treasury.address,
          value: parseEther('5'),
        },
      );
      inReceipt(receipt, 'SurplusBufferUpdated', {
        surplusBufferValue: parseEther('5'),
      });
      expect(await agToken.balanceOf(flashAngle.address)).to.be.equal(parseEther('0'));
      expect(await agToken.balanceOf(treasury.address)).to.be.equal(parseEther('5'));
      expect(await treasury.surplusBuffer()).to.be.equal(parseEther('5'));
    });
  });
});
