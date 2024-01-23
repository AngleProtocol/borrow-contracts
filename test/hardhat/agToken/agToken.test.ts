import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { Signer, utils } from 'ethers';
import { parseEther } from 'ethers/lib/utils';
import hre, { contract, ethers } from 'hardhat';

import { AgToken, AgToken__factory, MockTreasury, MockTreasury__factory } from '../../../typechain';
import { expect } from '../utils/chai-setup';
import { inIndirectReceipt, inReceipt } from '../utils/expectEvent';
import { deployUpgradeable, ZERO_ADDRESS } from '../utils/helpers';

contract('AgToken', () => {
  let deployer: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  let agToken: AgToken;
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
    // Example of upgradeable deployment - Default signer will be alice
    agToken = (await deployUpgradeable(new AgToken__factory(deployer))) as AgToken;

    treasury = (await new MockTreasury__factory(deployer).deploy(
      agToken.address,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
    )) as MockTreasury;

    await agToken.initialize('agEUR', 'agEUR', treasury.address);

    await treasury.addMinter(agToken.address, alice.address);
    await agToken.connect(alice).mint(alice.address, parseEther('1'));
  });

  describe('initializer', () => {
    it('success - stableMaster, name, symbol, treasury', async () => {
      expect(await agToken.name()).to.be.equal('agEUR');
      expect(await agToken.isMinter(alice.address)).to.be.equal(true);
      expect(await agToken.symbol()).to.be.equal('agEUR');
      expect(await agToken.treasury()).to.be.equal(treasury.address);
    });
    it('reverts - already initialized', async () => {
      await expect(agToken.initialize('agEUR', 'agEUR', ZERO_ADDRESS)).to.be.revertedWith(
        'Initializable: contract is already initialized',
      );
    });
    it('reverts - wrong treasury address', async () => {
      const agTokenRevert = (await deployUpgradeable(new AgToken__factory(deployer))) as AgToken;
      await expect(agTokenRevert.initialize('agEUR', 'agEUR', ZERO_ADDRESS)).to.be.reverted;
      const treasuryRevert = (await new MockTreasury__factory(deployer).deploy(
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        ZERO_ADDRESS,
      )) as MockTreasury;
      await expect(agTokenRevert.initialize('agEUR', 'agEUR', treasuryRevert.address)).to.be.revertedWith(
        'InvalidTreasury',
      );
    });
  });

  describe('mint', () => {
    it('reverts - wrong sender', async () => {
      await expect(agToken.connect(bob).mint(alice.address, parseEther('1'))).to.be.revertedWith('NotMinter');
    });
    it('success - alice mint (in the before each)', async () => {
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('1'));
      expect(await agToken.totalSupply()).to.be.equal(parseEther('1'));
    });
    it('reverts - zero address', async () => {
      await expect(agToken.connect(alice).mint(ZERO_ADDRESS, parseEther('1'))).to.be.reverted;
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
      await expect(agToken.connect(bob).burnSelf(parseEther('1'), alice.address)).to.be.revertedWith('NotMinter');
    });
    it('success - when minter', async () => {
      await agToken.connect(alice).burnSelf(parseEther('0.4'), alice.address);
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('0.6'));
      expect(await agToken.totalSupply()).to.be.equal(parseEther('0.6'));
    });
  });
  describe('burnFrom', () => {
    it('reverts - non minter', async () => {
      await expect(agToken.connect(bob).burnFrom(parseEther('1'), bob.address, alice.address)).to.be.revertedWith(
        'NotMinter',
      );
    });
    it('reverts - no approval', async () => {
      await expect(agToken.connect(alice).burnFrom(parseEther('1'), alice.address, bob.address)).to.be.revertedWith(
        'BurnAmountExceedsAllowance',
      );
    });
    it('success - with approval', async () => {
      await agToken.connect(alice).approve(bob.address, parseEther('2'));
      expect(await agToken.allowance(alice.address, bob.address)).to.be.equal(parseEther('2'));
      await agToken.connect(alice).burnFrom(parseEther('0.5'), alice.address, bob.address);
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('0.5'));
      expect(await agToken.allowance(alice.address, bob.address)).to.be.equal(parseEther('1.5'));
    });
    it('success - without approval but burner is sender', async () => {
      await agToken.connect(alice).burnFrom(parseEther('0.5'), alice.address, alice.address);
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('0.5'));
    });
  });
  describe('addMinter', () => {
    it('reverts - non treasury', async () => {
      await expect(agToken.connect(alice).addMinter(alice.address)).to.be.revertedWith('NotTreasury');
    });
    it('success - minter toggled', async () => {
      const receipt = await (await treasury.connect(alice).addMinter(agToken.address, bob.address)).wait();
      expect(await agToken.isMinter(bob.address)).to.be.true;
      inIndirectReceipt(
        receipt,
        new utils.Interface(['event MinterToggled(address indexed minter)']),
        'MinterToggled',
        {
          minter: bob.address,
        },
      );
    });
  });
  describe('removeMinter', () => {
    it('reverts - non treasury', async () => {
      await expect(agToken.connect(alice).removeMinter(bob.address)).to.be.revertedWith('InvalidSender');
    });
    it('success - minter removed after being added', async () => {
      await (await treasury.connect(alice).addMinter(agToken.address, bob.address)).wait();
      expect(await agToken.isMinter(bob.address)).to.be.true;
      await expect(agToken.connect(bob).removeMinter(alice.address)).to.be.revertedWith('InvalidSender');
      const receipt = await (await treasury.connect(alice).removeMinter(agToken.address, bob.address)).wait();
      inIndirectReceipt(
        receipt,
        new utils.Interface(['event MinterToggled(address indexed minter)']),
        'MinterToggled',
        {
          minter: bob.address,
        },
      );
      expect(await agToken.isMinter(bob.address)).to.be.false;
    });
    it('success - minter removed after requesting it', async () => {
      await (await treasury.connect(alice).addMinter(agToken.address, bob.address)).wait();
      expect(await agToken.isMinter(bob.address)).to.be.true;
      const receipt = await (await agToken.connect(bob).removeMinter(bob.address)).wait();
      inReceipt(receipt, 'MinterToggled', {
        minter: bob.address,
      });
      expect(await agToken.isMinter(bob.address)).to.be.false;
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
