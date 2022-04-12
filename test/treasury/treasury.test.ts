import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { Signer, utils } from 'ethers';
import { parseEther } from 'ethers/lib/utils';
import hre, { contract, ethers } from 'hardhat';

import {
  MockCoreBorrow,
  MockCoreBorrow__factory,
  MockFlashLoanModule,
  MockFlashLoanModule__factory,
  MockToken,
  MockToken__factory,
  MockVaultManager,
  MockVaultManager__factory,
  Treasury,
  Treasury__factory,
} from '../../typechain';
import { parseAmount } from '../../utils/bignumber';
import { expect } from '../utils/chai-setup';
import { inIndirectReceipt, inReceipt } from '../utils/expectEvent';
import { deployUpgradeable, ZERO_ADDRESS } from '../utils/helpers';

contract('Treasury', () => {
  let deployer: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  let coreBorrow: MockCoreBorrow;
  let stablecoin: MockToken;
  let vaultManager: MockVaultManager;
  let governor: string;
  let treasury: Treasury;

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
    // If the forked-network state needs to be reset between each test, run this
    // await network.provider.request({method: 'hardhat_reset', params: []});

    // To deploy a contract, import and use the contract factory specific to that contract

    treasury = (await deployUpgradeable(new Treasury__factory(deployer))) as Treasury;
    coreBorrow = (await new MockCoreBorrow__factory(deployer).deploy()) as MockCoreBorrow;
    vaultManager = (await new MockVaultManager__factory(deployer).deploy(treasury.address)) as MockVaultManager;

    stablecoin = (await new MockToken__factory(deployer).deploy('agEUR', 'agEUR', 18)) as MockToken;
    await coreBorrow.toggleGovernor(governor);
    await coreBorrow.toggleGuardian(governor);
    await treasury.initialize(coreBorrow.address, stablecoin.address);
  });

  describe('initializer', () => {
    it('success - stablecoin, core', async () => {
      expect(await treasury.core()).to.be.equal(coreBorrow.address);
      expect(await treasury.stablecoin()).to.be.equal(stablecoin.address);
      expect(await treasury.surplusManager()).to.be.equal(ZERO_ADDRESS);
      expect(await treasury.badDebt()).to.be.equal(0);
      expect(await treasury.surplusBuffer()).to.be.equal(0);
      expect(await treasury.surplusForGovernance()).to.be.equal(0);
    });
    it('reverts - already initialized', async () => {
      await expect(treasury.initialize(coreBorrow.address, stablecoin.address)).to.be.revertedWith(
        'Initializable: contract is already initialized',
      );
    });
    it('reverts - zero addresses', async () => {
      const treasuryRevert = (await deployUpgradeable(new Treasury__factory(deployer))) as Treasury;
      await expect(treasuryRevert.initialize(coreBorrow.address, ZERO_ADDRESS)).to.be.reverted;
      await expect(treasuryRevert.initialize(ZERO_ADDRESS, stablecoin.address)).to.be.reverted;
      await expect(treasuryRevert.initialize(ZERO_ADDRESS, ZERO_ADDRESS)).to.be.reverted;
    });
  });
  describe('isGovernor', () => {
    it('success - correct values', async () => {
      expect(await treasury.isGovernor(governor)).to.be.equal(true);
      expect(await treasury.isGovernor(alice.address)).to.be.equal(false);
    });
  });
  describe('isGovernorOrGuardian', () => {
    it('success - correct values', async () => {
      expect(await treasury.isGovernorOrGuardian(governor)).to.be.equal(true);
      expect(await treasury.isGovernorOrGuardian(alice.address)).to.be.equal(false);
    });
  });
  describe('setSurplusForGovernance', () => {
    it('reverts - non governor', async () => {
      await expect(treasury.setSurplusForGovernance(parseAmount.gwei(0.5))).to.be.revertedWith('1');
    });
    it('reverts - too high amount', async () => {
      await expect(
        treasury.connect(impersonatedSigners[governor]).setSurplusForGovernance(parseAmount.gwei(2)),
      ).to.be.revertedWith('9');
    });
    it('success - value updated', async () => {
      const receipt = await (
        await treasury.connect(impersonatedSigners[governor]).setSurplusForGovernance(parseAmount.gwei(0.5))
      ).wait();
      expect(await treasury.surplusForGovernance()).to.be.equal(parseAmount.gwei(0.5));
      inReceipt(receipt, 'SurplusForGovernanceUpdated', {
        _surplusForGovernance: parseAmount.gwei(0.5),
      });
    });
  });
  describe('addMinter', () => {
    it('reverts - non governor', async () => {
      await expect(treasury.addMinter(alice.address)).to.be.revertedWith('1');
    });
    it('reverts - zero value', async () => {
      await expect(treasury.connect(impersonatedSigners[governor]).addMinter(ZERO_ADDRESS)).to.be.revertedWith('0');
    });
    it('success - minter added', async () => {
      await (await treasury.connect(impersonatedSigners[governor]).addMinter(alice.address)).wait();
      expect(await stablecoin.minters(alice.address)).to.be.equal(true);
    });
  });
  describe('addVaultManager', () => {
    it('reverts - non governor', async () => {
      await expect(treasury.addVaultManager(alice.address)).to.be.revertedWith('1');
    });
    it('reverts - zero value', async () => {
      await expect(treasury.connect(impersonatedSigners[governor]).addVaultManager(ZERO_ADDRESS)).to.be.reverted;
    });
    it('reverts - wrong treasury', async () => {
      const vaultManager2 = (await new MockVaultManager__factory(deployer).deploy(alice.address)) as MockVaultManager;
      await expect(
        treasury.connect(impersonatedSigners[governor]).addVaultManager(vaultManager2.address),
      ).to.be.revertedWith('6');
    });
    it('success - vaultManager added', async () => {
      const receipt = await (
        await treasury.connect(impersonatedSigners[governor]).addVaultManager(vaultManager.address)
      ).wait();
      expect(await treasury.vaultManagerMap(vaultManager.address)).to.be.equal(true);
      expect(await treasury.vaultManagerList(0)).to.be.equal(vaultManager.address);
      inReceipt(receipt, 'VaultManagerToggled', {
        vaultManager: vaultManager.address,
      });
      expect(await treasury.isVaultManager(vaultManager.address)).to.be.equal(true);
      expect(await stablecoin.minters(vaultManager.address)).to.be.equal(true);
    });
    it('reverts - vaultManager already added', async () => {
      await treasury.connect(impersonatedSigners[governor]).addVaultManager(vaultManager.address);
      await expect(
        treasury.connect(impersonatedSigners[governor]).addVaultManager(vaultManager.address),
      ).to.be.revertedWith('5');
    });
  });
  describe('removeMinter', () => {
    it('reverts - non governor', async () => {
      await expect(treasury.removeMinter(alice.address)).to.be.revertedWith('1');
    });
    it('reverts - minter is a vaultManager', async () => {
      await treasury.connect(impersonatedSigners[governor]).addVaultManager(vaultManager.address);
      await expect(
        treasury.connect(impersonatedSigners[governor]).removeMinter(vaultManager.address),
      ).to.be.revertedWith('36');
    });
    it('success - minter removed', async () => {
      await (await treasury.connect(impersonatedSigners[governor]).addMinter(alice.address)).wait();
      await (await treasury.connect(impersonatedSigners[governor]).removeMinter(alice.address)).wait();
      expect(await stablecoin.minters(alice.address)).to.be.equal(false);
    });
  });
  describe('removeVaultManager', () => {
    it('reverts - non governor', async () => {
      await expect(treasury.removeVaultManager(alice.address)).to.be.revertedWith('1');
    });
    it('reverts - vaultManager has not been added yet', async () => {
      await expect(
        treasury.connect(impersonatedSigners[governor]).removeVaultManager(alice.address),
      ).to.be.revertedWith('3');
    });
    it('success - only one vaultManager', async () => {
      await treasury.connect(impersonatedSigners[governor]).addVaultManager(vaultManager.address);
      expect(await treasury.vaultManagerMap(vaultManager.address)).to.be.equal(true);
      const receipt = await (
        await treasury.connect(impersonatedSigners[governor]).removeVaultManager(vaultManager.address)
      ).wait();
      inReceipt(receipt, 'VaultManagerToggled', {
        vaultManager: vaultManager.address,
      });
      expect(await treasury.vaultManagerMap(vaultManager.address)).to.be.equal(false);
      await expect(treasury.vaultManagerList(0)).to.be.reverted;
      expect(await treasury.vaultManagerMap(vaultManager.address)).to.be.equal(false);
      expect(await stablecoin.minters(vaultManager.address)).to.be.equal(false);
    });
    it('success - several vaultManagers - first one removed', async () => {
      await treasury.connect(impersonatedSigners[governor]).addVaultManager(vaultManager.address);
      const vaultManager2 = (await new MockVaultManager__factory(deployer).deploy(
        treasury.address,
      )) as MockVaultManager;
      await treasury.connect(impersonatedSigners[governor]).addVaultManager(vaultManager2.address);
      expect(await treasury.vaultManagerMap(vaultManager.address)).to.be.equal(true);
      expect(await treasury.vaultManagerMap(vaultManager2.address)).to.be.equal(true);
      const receipt = await (
        await treasury.connect(impersonatedSigners[governor]).removeVaultManager(vaultManager.address)
      ).wait();
      inReceipt(receipt, 'VaultManagerToggled', {
        vaultManager: vaultManager.address,
      });
      expect(await treasury.vaultManagerMap(vaultManager2.address)).to.be.equal(true);
      expect(await treasury.vaultManagerMap(vaultManager.address)).to.be.equal(false);
      expect(await treasury.vaultManagerList(0)).to.be.equal(vaultManager2.address);
      expect(await stablecoin.minters(vaultManager.address)).to.be.equal(false);
      expect(await stablecoin.minters(vaultManager2.address)).to.be.equal(true);
    });
    it('success - several vaultManagers - second one removed', async () => {
      const vaultManager2 = (await new MockVaultManager__factory(deployer).deploy(
        treasury.address,
      )) as MockVaultManager;
      await treasury.connect(impersonatedSigners[governor]).addVaultManager(vaultManager2.address);
      await treasury.connect(impersonatedSigners[governor]).addVaultManager(vaultManager.address);
      const receipt = await (
        await treasury.connect(impersonatedSigners[governor]).removeVaultManager(vaultManager.address)
      ).wait();
      inReceipt(receipt, 'VaultManagerToggled', {
        vaultManager: vaultManager.address,
      });
      expect(await treasury.vaultManagerMap(vaultManager2.address)).to.be.equal(true);
      expect(await treasury.vaultManagerMap(vaultManager.address)).to.be.equal(false);
      expect(await treasury.vaultManagerList(0)).to.be.equal(vaultManager2.address);
      expect(await stablecoin.minters(vaultManager.address)).to.be.equal(false);
      expect(await stablecoin.minters(vaultManager2.address)).to.be.equal(true);
    });
  });
  describe('recoverERC20', () => {
    it('reverts - non governor', async () => {
      await expect(treasury.recoverERC20(alice.address, alice.address, parseEther('1'))).to.be.revertedWith('1');
    });
    it('success - non stablecoin token address', async () => {
      const token = (await new MockToken__factory(deployer).deploy('agEUR', 'agEUR', 18)) as MockToken;
      await token.mint(treasury.address, parseEther('10'));
      const receipt = await (
        await treasury
          .connect(impersonatedSigners[governor])
          .recoverERC20(token.address, alice.address, parseEther('1'))
      ).wait();
      inReceipt(receipt, 'Recovered', {
        token: token.address,
        to: alice.address,
        amount: parseEther('1'),
      });
      expect(await token.balanceOf(alice.address)).to.be.equal(parseEther('1'));
      expect(await token.balanceOf(treasury.address)).to.be.equal(parseEther('9'));
    });
    it('success - non stablecoin token address and too high amount', async () => {
      const token = (await new MockToken__factory(deployer).deploy('agEUR', 'agEUR', 18)) as MockToken;
      await token.mint(treasury.address, parseEther('10'));
      await expect(
        treasury.connect(impersonatedSigners[governor]).recoverERC20(token.address, alice.address, parseEther('100')),
      ).to.be.reverted;
    });
    it('reverts - stablecoin token address and too high amount', async () => {
      await expect(
        treasury
          .connect(impersonatedSigners[governor])
          .recoverERC20(stablecoin.address, alice.address, parseEther('1')),
      ).to.be.reverted;
    });
    it('success - stablecoin token address', async () => {
      await stablecoin.mint(treasury.address, parseEther('10'));
      const receipt = await (
        await treasury
          .connect(impersonatedSigners[governor])
          .recoverERC20(stablecoin.address, alice.address, parseEther('1'))
      ).wait();
      inReceipt(receipt, 'Recovered', {
        token: stablecoin.address,
        to: alice.address,
        amount: parseEther('1'),
      });
      expect(await stablecoin.balanceOf(alice.address)).to.be.equal(parseEther('1'));
      expect(await stablecoin.balanceOf(treasury.address)).to.be.equal(parseEther('9'));
    });
  });
  describe('setTreasury', () => {
    it('reverts - nonGovernor', async () => {
      await expect(treasury.setTreasury(alice.address)).to.be.revertedWith('1');
    });
    it('reverts - still wrong stablecoin', async () => {
      const newTreasury = (await deployUpgradeable(new Treasury__factory(deployer))) as Treasury;
      newTreasury.initialize(coreBorrow.address, alice.address);
      await expect(treasury.connect(impersonatedSigners[governor]).setTreasury(newTreasury.address)).to.be.revertedWith(
        '6',
      );
    });
    it('reverts - still flashLoaner', async () => {
      await coreBorrow.toggleFlashLoaners(treasury.address);
      const newTreasury = (await deployUpgradeable(new Treasury__factory(deployer))) as Treasury;
      await newTreasury.initialize(coreBorrow.address, stablecoin.address);
      await expect(treasury.connect(impersonatedSigners[governor]).setTreasury(newTreasury.address)).to.be.revertedWith(
        '7',
      );
    });
    it('success - no vaultManager', async () => {
      const newTreasury = (await deployUpgradeable(new Treasury__factory(deployer))) as Treasury;
      await newTreasury.initialize(coreBorrow.address, stablecoin.address);
      const receipt = await (
        await treasury.connect(impersonatedSigners[governor]).setTreasury(newTreasury.address)
      ).wait();
      inReceipt(receipt, 'NewTreasurySet', {
        _treasury: newTreasury.address,
      });
      expect(await stablecoin.treasury()).to.be.equal(newTreasury.address);
    });
    it('success - with a VaultManager', async () => {
      const newTreasury = (await deployUpgradeable(new Treasury__factory(deployer))) as Treasury;
      await newTreasury.initialize(coreBorrow.address, stablecoin.address);
      await treasury.connect(impersonatedSigners[governor]).addVaultManager(vaultManager.address);
      const receipt = await (
        await treasury.connect(impersonatedSigners[governor]).setTreasury(newTreasury.address)
      ).wait();
      inReceipt(receipt, 'NewTreasurySet', {
        _treasury: newTreasury.address,
      });
      expect(await vaultManager.treasury()).to.be.equal(newTreasury.address);
      expect(await stablecoin.treasury()).to.be.equal(newTreasury.address);
    });
  });
  describe('setSurplusManager', () => {
    it('reverts - non governor', async () => {
      await expect(treasury.setSurplusManager(alice.address)).to.be.revertedWith('1');
    });
    it('reverts - zero value', async () => {
      await expect(treasury.connect(impersonatedSigners[governor]).setSurplusManager(ZERO_ADDRESS)).to.be.revertedWith(
        '0',
      );
    });
    it('success - value updated', async () => {
      const receipt = await (
        await treasury.connect(impersonatedSigners[governor]).setSurplusManager(alice.address)
      ).wait();
      expect(await treasury.surplusManager()).to.be.equal(alice.address);
      inReceipt(receipt, 'SurplusManagerUpdated', {
        _surplusManager: alice.address,
      });
    });
  });
  describe('setCore', () => {
    it('reverts - non governor', async () => {
      await expect(treasury.setCore(alice.address)).to.be.revertedWith('1');
    });
    it('reverts - invalid core contract', async () => {
      const coreBorrowNew = (await new MockCoreBorrow__factory(deployer).deploy()) as MockCoreBorrow;
      await expect(treasury.connect(impersonatedSigners[governor]).setCore(coreBorrowNew.address)).to.be.revertedWith(
        '1',
      );
    });
    it('success - value updated', async () => {
      const coreBorrowNew = (await new MockCoreBorrow__factory(deployer).deploy()) as MockCoreBorrow;
      await coreBorrowNew.toggleGovernor(governor);

      const receipt = await (
        await treasury.connect(impersonatedSigners[governor]).setCore(coreBorrowNew.address)
      ).wait();
      inReceipt(receipt, 'CoreUpdated', {
        _core: coreBorrowNew.address,
      });
    });
  });
  describe('setFlashLoanModule', () => {
    it('reverts - non core', async () => {
      await expect(treasury.setFlashLoanModule(alice.address)).to.be.revertedWith('10');
    });
    it('success - when no old flash loan Module', async () => {
      await coreBorrow.setFlashLoanModule(treasury.address, alice.address);
      expect(await treasury.flashLoanModule()).to.be.equal(alice.address);
      expect(await stablecoin.minters(alice.address)).to.be.equal(true);
    });
    it('success - when there is an old flash loan Module', async () => {
      await coreBorrow.setFlashLoanModule(treasury.address, alice.address);
      await coreBorrow.setFlashLoanModule(treasury.address, bob.address);
      expect(await treasury.flashLoanModule()).to.be.equal(bob.address);
      expect(await stablecoin.minters(alice.address)).to.be.equal(false);
      expect(await stablecoin.minters(bob.address)).to.be.equal(true);
    });
    it('success - when flash loan Module is address 0', async () => {
      await coreBorrow.setFlashLoanModule(treasury.address, alice.address);
      await coreBorrow.setFlashLoanModule(treasury.address, ZERO_ADDRESS);
      expect(await treasury.flashLoanModule()).to.be.equal(ZERO_ADDRESS);
      expect(await stablecoin.minters(alice.address)).to.be.equal(false);
      expect(await stablecoin.minters(bob.address)).to.be.equal(false);
    });
  });
  describe('fetchSurplusFromAll', () => {
    it('success - no vaultManager/no flashLoanModule', async () => {
      await treasury.fetchSurplusFromAll();
      expect(await treasury.badDebt()).to.be.equal(0);
      expect(await treasury.surplusBuffer()).to.be.equal(0);
    });
    it('success - one vaultManager - just surplus', async () => {
      await treasury.connect(impersonatedSigners[governor]).addVaultManager(vaultManager.address);
      await vaultManager.setSurplusBadDebt(parseEther('1'), 0, stablecoin.address);
      const receipt = await (await treasury.fetchSurplusFromAll()).wait();
      expect(await treasury.surplusBuffer()).to.be.equal(parseEther('1'));
      expect(await treasury.badDebt()).to.be.equal(parseEther('0'));
      inReceipt(receipt, 'SurplusBufferUpdated', {
        surplusBufferValue: parseEther('1'),
      });
      inReceipt(receipt, 'BadDebtUpdated', {
        badDebtValue: parseEther('0'),
      });
      expect(await stablecoin.balanceOf(treasury.address)).to.be.equal(parseEther('1'));
    });
    it('success - with badDebt > balance', async () => {
      await treasury.connect(impersonatedSigners[governor]).addVaultManager(vaultManager.address);
      await vaultManager.setSurplusBadDebt(0, parseEther('10'), stablecoin.address);
      await stablecoin.mint(treasury.address, parseEther('5'));
      const receipt = await (await treasury.fetchSurplusFromAll()).wait();
      expect(await treasury.surplusBuffer()).to.be.equal(parseEther('0'));
      expect(await treasury.badDebt()).to.be.equal(parseEther('5'));
      inReceipt(receipt, 'SurplusBufferUpdated', {
        surplusBufferValue: parseEther('0'),
      });
      inReceipt(receipt, 'BadDebtUpdated', {
        badDebtValue: parseEther('5'),
      });
      inIndirectReceipt(
        receipt,
        new utils.Interface(['event Burning(address indexed _from, address indexed _burner, uint256 _amount)']),
        'Burning',
        {
          _from: treasury.address,
          _burner: treasury.address,
          _amount: parseEther('5'),
        },
      );
      expect(await stablecoin.balanceOf(treasury.address)).to.be.equal(parseEther('0'));
    });
    it('success - with badDebt < balance && badDebt > surplusBuffer', async () => {
      await treasury.connect(impersonatedSigners[governor]).addVaultManager(vaultManager.address);
      await vaultManager.setSurplusBadDebt(0, parseEther('10'), stablecoin.address);
      await stablecoin.mint(treasury.address, parseEther('15'));
      const receipt = await (await treasury.fetchSurplusFromAll()).wait();
      expect(await treasury.surplusBuffer()).to.be.equal(parseEther('0'));
      expect(await treasury.badDebt()).to.be.equal(parseEther('0'));
      inReceipt(receipt, 'SurplusBufferUpdated', {
        surplusBufferValue: parseEther('0'),
      });
      inReceipt(receipt, 'BadDebtUpdated', {
        badDebtValue: parseEther('0'),
      });
      inIndirectReceipt(
        receipt,
        new utils.Interface(['event Burning(address indexed _from, address indexed _burner, uint256 _amount)']),
        'Burning',
        {
          _from: treasury.address,
          _burner: treasury.address,
          _amount: parseEther('10'),
        },
      );
      expect(await stablecoin.balanceOf(treasury.address)).to.be.equal(parseEther('5'));
    });
    it('success - with badDebt < balance && badDebt < surplusBuffer', async () => {
      await treasury.connect(impersonatedSigners[governor]).addVaultManager(vaultManager.address);
      await vaultManager.setSurplusBadDebt(parseEther('15'), parseEther('10'), stablecoin.address);
      await stablecoin.mint(treasury.address, parseEther('15'));
      const receipt = await (await treasury.fetchSurplusFromAll()).wait();
      expect(await treasury.surplusBuffer()).to.be.equal(parseEther('5'));
      expect(await treasury.badDebt()).to.be.equal(parseEther('0'));
      inReceipt(receipt, 'SurplusBufferUpdated', {
        surplusBufferValue: parseEther('5'),
      });
      inReceipt(receipt, 'BadDebtUpdated', {
        badDebtValue: parseEther('0'),
      });
      inIndirectReceipt(
        receipt,
        new utils.Interface(['event Burning(address indexed _from, address indexed _burner, uint256 _amount)']),
        'Burning',
        {
          _from: treasury.address,
          _burner: treasury.address,
          _amount: parseEther('10'),
        },
      );
      // What is minted with the mock is surplus - badDebt so in fact here it's double burnt
      expect(await stablecoin.balanceOf(treasury.address)).to.be.equal(parseEther('10'));
    });
    it('success - with a flashLoan module and 0 surplus from it', async () => {
      const flashAngle = (await new MockFlashLoanModule__factory(deployer).deploy(
        coreBorrow.address,
      )) as MockFlashLoanModule;
      await coreBorrow.setFlashLoanModule(treasury.address, flashAngle.address);
      await treasury.connect(impersonatedSigners[governor]).addVaultManager(vaultManager.address);
      await vaultManager.setSurplusBadDebt(parseEther('1'), 0, stablecoin.address);
      const receipt = await (await treasury.fetchSurplusFromAll()).wait();
      expect(await treasury.surplusBuffer()).to.be.equal(parseEther('1'));
      expect(await treasury.badDebt()).to.be.equal(parseEther('0'));
      inReceipt(receipt, 'SurplusBufferUpdated', {
        surplusBufferValue: parseEther('1'),
      });
      inReceipt(receipt, 'BadDebtUpdated', {
        badDebtValue: parseEther('0'),
      });
      expect(await stablecoin.balanceOf(treasury.address)).to.be.equal(parseEther('1'));
    });
    it('success - with a flashLoan module and surplus from it', async () => {
      const flashAngle = (await new MockFlashLoanModule__factory(deployer).deploy(
        coreBorrow.address,
      )) as MockFlashLoanModule;
      await flashAngle.setSurplusValue(parseEther('10'));
      await coreBorrow.setFlashLoanModule(treasury.address, flashAngle.address);
      await treasury.connect(impersonatedSigners[governor]).addVaultManager(vaultManager.address);
      await vaultManager.setSurplusBadDebt(parseEther('1'), 0, stablecoin.address);
      const receipt = await (await treasury.fetchSurplusFromAll()).wait();
      expect(await treasury.surplusBuffer()).to.be.equal(parseEther('11'));
      expect(await treasury.badDebt()).to.be.equal(parseEther('0'));
      inReceipt(receipt, 'SurplusBufferUpdated', {
        surplusBufferValue: parseEther('11'),
      });
      inReceipt(receipt, 'BadDebtUpdated', {
        badDebtValue: parseEther('0'),
      });
      // Value not updated by the MockFlashAngle contract
      expect(await stablecoin.balanceOf(treasury.address)).to.be.equal(parseEther('1'));
    });
    it('success - two vaultManagers - just surplus', async () => {
      const vaultManager2 = (await new MockVaultManager__factory(deployer).deploy(
        treasury.address,
      )) as MockVaultManager;
      await treasury.connect(impersonatedSigners[governor]).addVaultManager(vaultManager.address);
      await treasury.connect(impersonatedSigners[governor]).addVaultManager(vaultManager2.address);
      await vaultManager.setSurplusBadDebt(parseEther('1'), 0, stablecoin.address);
      await vaultManager2.setSurplusBadDebt(parseEther('2'), 0, stablecoin.address);
      const receipt = await (await treasury.fetchSurplusFromAll()).wait();
      expect(await treasury.surplusBuffer()).to.be.equal(parseEther('3'));
      expect(await treasury.badDebt()).to.be.equal(parseEther('0'));
      inReceipt(receipt, 'SurplusBufferUpdated', {
        surplusBufferValue: parseEther('3'),
      });
      inReceipt(receipt, 'BadDebtUpdated', {
        badDebtValue: parseEther('0'),
      });
      expect(await stablecoin.balanceOf(treasury.address)).to.be.equal(parseEther('3'));
    });
    it('success - two vaultManagers - surplus and bad debt', async () => {
      const vaultManager2 = (await new MockVaultManager__factory(deployer).deploy(
        treasury.address,
      )) as MockVaultManager;
      await treasury.connect(impersonatedSigners[governor]).addVaultManager(vaultManager.address);
      await treasury.connect(impersonatedSigners[governor]).addVaultManager(vaultManager2.address);
      await vaultManager.setSurplusBadDebt(parseEther('1'), 0, stablecoin.address);
      await vaultManager2.setSurplusBadDebt(0, parseEther('2'), stablecoin.address);
      const receipt = await (await treasury.fetchSurplusFromAll()).wait();
      expect(await treasury.surplusBuffer()).to.be.equal(parseEther('0'));
      expect(await treasury.badDebt()).to.be.equal(parseEther('1'));
      inReceipt(receipt, 'SurplusBufferUpdated', {
        surplusBufferValue: parseEther('0'),
      });
      inReceipt(receipt, 'BadDebtUpdated', {
        badDebtValue: parseEther('1'),
      });
      expect(await stablecoin.balanceOf(treasury.address)).to.be.equal(parseEther('0'));
    });
  });
  describe('fetchSurplusFromFlashLoan', () => {
    it('reverts - if no flashLoanModule', async () => {
      await expect(treasury.fetchSurplusFromFlashLoan()).to.be.reverted;
    });
    it('success - with a flashLoan module and 0 surplus from it', async () => {
      const flashAngle = (await new MockFlashLoanModule__factory(deployer).deploy(
        coreBorrow.address,
      )) as MockFlashLoanModule;
      await coreBorrow.setFlashLoanModule(treasury.address, flashAngle.address);
      const receipt = await (await treasury.fetchSurplusFromFlashLoan()).wait();
      expect(await treasury.surplusBuffer()).to.be.equal(parseEther('0'));
      expect(await treasury.badDebt()).to.be.equal(parseEther('0'));
      inReceipt(receipt, 'SurplusBufferUpdated', {
        surplusBufferValue: parseEther('0'),
      });
      inReceipt(receipt, 'BadDebtUpdated', {
        badDebtValue: parseEther('0'),
      });
    });
    it('success - with a flashLoan module and surplus from it', async () => {
      const flashAngle = (await new MockFlashLoanModule__factory(deployer).deploy(
        coreBorrow.address,
      )) as MockFlashLoanModule;
      await flashAngle.setSurplusValue(parseEther('10'));
      await coreBorrow.setFlashLoanModule(treasury.address, flashAngle.address);
      const receipt = await (await treasury.fetchSurplusFromFlashLoan()).wait();
      expect(await treasury.surplusBuffer()).to.be.equal(parseEther('10'));
      expect(await treasury.badDebt()).to.be.equal(parseEther('0'));
      inReceipt(receipt, 'SurplusBufferUpdated', {
        surplusBufferValue: parseEther('10'),
      });
      inReceipt(receipt, 'BadDebtUpdated', {
        badDebtValue: parseEther('0'),
      });
    });
  });
  describe('pushSurplus', () => {
    it('reverts - non-initialized surplusManager', async () => {
      await expect(treasury.pushSurplus()).to.be.revertedWith('0');
    });
    it('success - surplusManager initialized and surplus', async () => {
      await treasury.connect(impersonatedSigners[governor]).setSurplusManager(alice.address);
      await treasury.connect(impersonatedSigners[governor]).addVaultManager(vaultManager.address);
      await treasury.connect(impersonatedSigners[governor]).setSurplusForGovernance(parseAmount.gwei(0.3));
      await vaultManager.setSurplusBadDebt(parseEther('10'), 0, stablecoin.address);
      const receipt = await (await treasury.pushSurplus()).wait();
      inReceipt(receipt, 'SurplusBufferUpdated', {
        surplusBufferValue: parseEther('10'),
      });
      inReceipt(receipt, 'SurplusBufferUpdated', {
        surplusBufferValue: parseEther('0'),
      });
      inIndirectReceipt(
        receipt,
        new utils.Interface(['event Transfer(address indexed from, address indexed to, uint256 value)']),
        'Transfer',
        {
          from: treasury.address,
          to: alice.address,
          value: parseEther('3'),
        },
      );
      expect(await stablecoin.balanceOf(alice.address)).to.be.equal(parseEther('3'));
      expect(await stablecoin.balanceOf(treasury.address)).to.be.equal(parseEther('7'));
    });
  });
  describe('updateBadDebt', () => {
    it('reverts - too high amount', async () => {
      await expect(treasury.updateBadDebt(1)).to.be.revertedWith('ERC20: burn amount exceeds balance');
    });
    it('reverts - nothing to burn in the contract', async () => {
      await treasury.connect(impersonatedSigners[governor]).addVaultManager(vaultManager.address);
      await vaultManager.setSurplusBadDebt(0, parseEther('10'), stablecoin.address);
      await treasury.fetchSurplusFromAll();
      expect(await treasury.surplusBuffer()).to.be.equal(parseEther('0'));
      expect(await treasury.badDebt()).to.be.equal(parseEther('10'));
      await expect(treasury.connect(impersonatedSigners[governor]).updateBadDebt(parseEther('10'))).to.be.reverted;
    });
    it('success - burns elements from the contract', async () => {
      await treasury.connect(impersonatedSigners[governor]).addVaultManager(vaultManager.address);
      await vaultManager.setSurplusBadDebt(0, parseEther('10'), stablecoin.address);
      await treasury.fetchSurplusFromAll();
      expect(await treasury.surplusBuffer()).to.be.equal(parseEther('0'));
      expect(await treasury.badDebt()).to.be.equal(parseEther('10'));
      await stablecoin.mint(treasury.address, parseEther('7'));
      const receipt = await (
        await treasury.connect(impersonatedSigners[governor]).updateBadDebt(parseEther('7'))
      ).wait();
      expect(await treasury.badDebt()).to.be.equal(parseEther('3'));
      inReceipt(receipt, 'BadDebtUpdated', {
        badDebtValue: parseEther('3'),
      });
    });
  });
});
