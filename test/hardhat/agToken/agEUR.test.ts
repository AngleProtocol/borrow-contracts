import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { Signer, utils } from 'ethers';
import { parseEther } from 'ethers/lib/utils';
import hre, { contract, ethers } from 'hardhat';

import {
  MockStableMaster,
  MockStableMaster__factory,
  MockTreasury,
  MockTreasury__factory,
  OldAgEUR,
  OldAgEUR__factory,
} from '../../../typechain';
import { expect } from '../utils/chai-setup';
import { inIndirectReceipt, inReceipt } from '../utils/expectEvent';
import { deployUpgradeable, ZERO_ADDRESS } from '../utils/helpers';

contract('agEUR', () => {
  let deployer: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  let agToken: OldAgEUR;
  let stableMaster: MockStableMaster;
  let governor: string;
  let treasury: MockTreasury;

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

    stableMaster = (await new MockStableMaster__factory(deployer).deploy()) as MockStableMaster;

    // Example of upgradeable deployment - Default signer will be alice
    agToken = (await deployUpgradeable(new OldAgEUR__factory(deployer))) as OldAgEUR;

    treasury = (await new MockTreasury__factory(deployer).deploy(
      agToken.address,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
    )) as MockTreasury;

    await agToken.initialize('agEUR', 'agEUR', stableMaster.address);

    await agToken.connect(impersonatedSigners[governor]).setUpTreasury(treasury.address);
    await stableMaster.mint(agToken.address, alice.address, parseEther('1'));
  });

  describe('initializer', () => {
    it('success - stableMaster, name, symbol, treasury', async () => {
      expect(await agToken.stableMaster()).to.be.equal(stableMaster.address);
      expect(await agToken.name()).to.be.equal('agEUR');
      expect(await agToken.isMinter(stableMaster.address)).to.be.equal(true);
      expect(await agToken.symbol()).to.be.equal('agEUR');
      expect(await agToken.treasury()).to.be.equal(treasury.address);
      expect(await agToken.treasuryInitialized()).to.be.equal(true);
    });
    it('reverts - already initialized', async () => {
      await expect(agToken.initialize('agEUR', 'agEUR', ZERO_ADDRESS)).to.be.revertedWith(
        'Initializable: contract is already initialized',
      );
    });
    it('reverts - zero stableMaster address', async () => {
      const agTokenRevert = (await deployUpgradeable(new OldAgEUR__factory(deployer))) as OldAgEUR;
      await expect(agTokenRevert.initialize('agEUR', 'agEUR', ZERO_ADDRESS)).to.be.revertedWith('0');
    });
  });
  describe('setUpTreasury', () => {
    it('reverts - wrong sender', async () => {
      await expect(agToken.setUpTreasury(ZERO_ADDRESS)).to.be.revertedWith('NotGovernor');
    });
    it('reverts - wrong stablecoin', async () => {
      const mockTreasuryWrong = (await new MockTreasury__factory(deployer).deploy(
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        ZERO_ADDRESS,
      )) as MockTreasury;
      await expect(
        agToken.connect(impersonatedSigners[governor]).setUpTreasury(mockTreasuryWrong.address),
      ).to.be.revertedWith('InvalidTreasury');
    });
    it('reverts - treasuryInitialized', async () => {
      await expect(agToken.connect(impersonatedSigners[governor]).setUpTreasury(treasury.address)).to.be.revertedWith(
        'TreasuryAlreadyInitialized',
      );
    });
  });
  describe('mint', () => {
    it('reverts - wrong sender', async () => {
      await expect(agToken.connect(alice).mint(alice.address, parseEther('1'))).to.be.revertedWith('NotMinter');
    });
    it('success - stableMaster mint (in the before each)', async () => {
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('1'));
      expect(await agToken.totalSupply()).to.be.equal(parseEther('1'));
    });
    it('reverts - zero address', async () => {
      await expect(stableMaster.mint(agToken.address, ZERO_ADDRESS, parseEther('1'))).to.be.reverted;
    });
  });
  describe('burnNoRedeem', () => {
    it('success - balanceUpdated', async () => {
      await agToken.connect(alice).burnNoRedeem(parseEther('0.5'), alice.address);
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('0.5'));
      expect(await stableMaster.poolManagerMap(alice.address)).to.be.equal(parseEther('0.5'));
    });
    it('reverts - too high balance', async () => {
      await expect(agToken.connect(alice).burnNoRedeem(parseEther('1.1'), ZERO_ADDRESS)).to.be.reverted;
    });
  });
  describe('burnFromNoRedeem', () => {
    it('reverts - burn for someone else and no approval', async () => {
      await stableMaster.mint(agToken.address, bob.address, parseEther('1'));
      await expect(
        agToken.connect(alice).burnFromNoRedeem(bob.address, parseEther('0.5'), alice.address),
      ).to.be.revertedWith('BurnAmountExceedsAllowance');
    });
    it('success - when allowance', async () => {
      await agToken.connect(alice).approve(bob.address, parseEther('2'));
      expect(await agToken.allowance(alice.address, bob.address)).to.be.equal(parseEther('2'));
      await agToken.connect(bob).burnFromNoRedeem(alice.address, parseEther('0.5'), alice.address);
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('0.5'));
      expect(await agToken.allowance(alice.address, bob.address)).to.be.equal(parseEther('1.5'));
      expect(await stableMaster.poolManagerMap(alice.address)).to.be.equal(parseEther('0.5'));
    });
  });
  describe('burnStablecoin', () => {
    it('success - when non null balance', async () => {
      await agToken.connect(alice).burnStablecoin(parseEther('0.3'));
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('0.7'));
    });
    it('reverts - when greater than balance', async () => {
      await expect(agToken.connect(alice).burnStablecoin(parseEther('1.3'))).to.be.reverted;
    });
  });
  describe('burnSelf', () => {
    it('reverts - non minter', async () => {
      await expect(agToken.connect(alice).burnSelf(parseEther('1'), alice.address)).to.be.revertedWith('NotMinter');
    });
    it('success - when minter', async () => {
      await stableMaster.burnSelf(agToken.address, parseEther('0.4'), alice.address);
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('0.6'));
      expect(await agToken.totalSupply()).to.be.equal(parseEther('0.6'));
    });
  });
  describe('burnFrom', () => {
    it('reverts - non minter', async () => {
      await expect(agToken.connect(alice).burnFrom(parseEther('1'), bob.address, alice.address)).to.be.revertedWith(
        'NotMinter',
      );
    });
    it('reverts - no approval', async () => {
      await expect(
        stableMaster.connect(bob).burnFrom(agToken.address, parseEther('1'), alice.address, bob.address),
      ).to.be.revertedWith('BurnAmountExceedsAllowance');
    });
    it('success - with approval', async () => {
      await agToken.connect(alice).approve(bob.address, parseEther('2'));
      expect(await agToken.allowance(alice.address, bob.address)).to.be.equal(parseEther('2'));
      await stableMaster.connect(bob).burnFrom(agToken.address, parseEther('0.5'), alice.address, bob.address);
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('0.5'));
      expect(await agToken.allowance(alice.address, bob.address)).to.be.equal(parseEther('1.5'));
    });
  });
  describe('addMinter', () => {
    it('reverts - non treasury', async () => {
      await expect(agToken.connect(alice).addMinter(alice.address)).to.be.revertedWith('NotTreasury');
    });
    it('success - minter toggled', async () => {
      const receipt = await (await treasury.connect(alice).addMinter(agToken.address, alice.address)).wait();
      expect(await agToken.isMinter(alice.address)).to.be.true;
      inIndirectReceipt(
        receipt,
        new utils.Interface(['event MinterToggled(address indexed minter)']),
        'MinterToggled',
        {
          minter: alice.address,
        },
      );
    });
  });
  describe('removeMinter', () => {
    it('reverts - non treasury', async () => {
      await expect(agToken.connect(alice).removeMinter(bob.address)).to.be.revertedWith('InvalidSender');
    });
    it('reverts - removing stableMaster from the treasury', async () => {
      await expect(treasury.connect(alice).removeMinter(agToken.address, stableMaster.address)).to.be.revertedWith(
        'InvalidSender',
      );
    });
    it('success - minter removed after being added', async () => {
      await (await treasury.connect(alice).addMinter(agToken.address, alice.address)).wait();
      expect(await agToken.isMinter(alice.address)).to.be.true;
      await expect(agToken.connect(bob).removeMinter(alice.address)).to.be.revertedWith('InvalidSender');
      const receipt = await (await treasury.connect(alice).removeMinter(agToken.address, alice.address)).wait();
      inIndirectReceipt(
        receipt,
        new utils.Interface(['event MinterToggled(address indexed minter)']),
        'MinterToggled',
        {
          minter: alice.address,
        },
      );
    });
    it('success - minter removed after requesting it', async () => {
      await (await treasury.connect(alice).addMinter(agToken.address, alice.address)).wait();
      const receipt = await (await agToken.connect(alice).removeMinter(alice.address)).wait();
      inReceipt(receipt, 'MinterToggled', {
        minter: alice.address,
      });
    });
  });
  describe('setTreasury', () => {
    it('reverts - non treasury', async () => {
      await expect(agToken.connect(alice).setTreasury(alice.address)).to.be.revertedWith('NotTreasury');
    });
    it('success - treasury updated', async () => {
      const receipt = await (await treasury.connect(alice).setTreasury(agToken.address, alice.address)).wait();
      expect(await agToken.treasury()).to.be.equal(alice.address);
      inIndirectReceipt(
        receipt,
        new utils.Interface(['event TreasuryUpdated(address indexed _treasury)']),
        'TreasuryUpdated',
        {
          _treasury: alice.address,
        },
      );
    });
    it('success - treasury updated and reset', async () => {
      await (await treasury.connect(alice).setTreasury(agToken.address, alice.address)).wait();
      const receipt = await (await agToken.connect(alice).setTreasury(treasury.address)).wait();
      expect(await agToken.treasury()).to.be.equal(treasury.address);
      inReceipt(receipt, 'TreasuryUpdated', {
        _treasury: treasury.address,
      });
    });
  });
});
