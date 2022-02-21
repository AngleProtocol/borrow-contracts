import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { Signer, utils } from 'ethers';
import { parseEther } from 'ethers/lib/utils';
import hre, { contract, ethers } from 'hardhat';

import {
  AgToken,
  AgToken__factory,
  MockStableMaster,
  MockStableMaster__factory,
  MockTreasury,
  MockTreasury__factory,
} from '../../typechain';
import { expect } from '../utils/chai-setup';
import { inIndirectReceipt, inReceipt } from '../utils/expectEvent';
import { deployUpgradeable, ZERO_ADDRESS } from '../utils/helpers';

contract('AgToken', () => {
  let deployer: SignerWithAddress;
  let user: SignerWithAddress;
  let user2: SignerWithAddress;

  let agToken: AgToken;
  let stableMaster: MockStableMaster;
  let governor: string;
  let treasury: MockTreasury;

  const impersonatedSigners: { [key: string]: Signer } = {};

  before(async () => {
    [deployer, user, user2] = await ethers.getSigners();
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
    agToken = (await deployUpgradeable(new AgToken__factory(deployer))) as AgToken;

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
    await stableMaster.mint(agToken.address, user.address, parseEther('1'));
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
      const agTokenRevert = (await deployUpgradeable(new AgToken__factory(deployer))) as AgToken;
      await expect(agTokenRevert.initialize('agEUR', 'agEUR', ZERO_ADDRESS)).to.be.revertedWith('0');
    });
  });
  describe('setUpTreasury', () => {
    it('reverts - wrong sender', async () => {
      await expect(agToken.setUpTreasury(ZERO_ADDRESS)).to.be.revertedWith('1');
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
      ).to.be.revertedWith('19');
    });
    it('reverts - treasuryInitialized', async () => {
      await expect(agToken.connect(impersonatedSigners[governor]).setUpTreasury(treasury.address)).to.be.revertedWith(
        '34',
      );
    });
  });
  describe('mint', () => {
    it('reverts - wrong sender', async () => {
      await expect(agToken.connect(user).mint(user.address, parseEther('1'))).to.be.revertedWith('35');
    });
    it('success - stableMaster mint (in the before each)', async () => {
      expect(await agToken.balanceOf(user.address)).to.be.equal(parseEther('1'));
      expect(await agToken.totalSupply()).to.be.equal(parseEther('1'));
    });
    it('reverts - zero address', async () => {
      await expect(stableMaster.mint(agToken.address, ZERO_ADDRESS, parseEther('1'))).to.be.reverted;
    });
  });
  describe('burnNoRedeem', () => {
    it('success - balanceUpdated', async () => {
      await agToken.connect(user).burnNoRedeem(parseEther('0.5'), user.address);
      expect(await agToken.balanceOf(user.address)).to.be.equal(parseEther('0.5'));
      expect(await stableMaster.poolManagerMap(user.address)).to.be.equal(parseEther('0.5'));
    });
    it('reverts - too high balance', async () => {
      await expect(agToken.connect(user).burnNoRedeem(parseEther('1.1'), ZERO_ADDRESS)).to.be.reverted;
    });
  });
  describe('burnFromNoRedeem', () => {
    it('reverts - burn for someone else and no approval', async () => {
      await stableMaster.mint(agToken.address, user2.address, parseEther('1'));
      await expect(
        agToken.connect(user).burnFromNoRedeem(user2.address, parseEther('0.5'), user.address),
      ).to.be.revertedWith('23');
    });
    it('success - when allowance', async () => {
      await agToken.connect(user).approve(user2.address, parseEther('2'));
      expect(await agToken.allowance(user.address, user2.address)).to.be.equal(parseEther('2'));
      await agToken.connect(user2).burnFromNoRedeem(user.address, parseEther('0.5'), user.address);
      expect(await agToken.balanceOf(user.address)).to.be.equal(parseEther('0.5'));
      expect(await agToken.allowance(user.address, user2.address)).to.be.equal(parseEther('1.5'));
      expect(await stableMaster.poolManagerMap(user.address)).to.be.equal(parseEther('0.5'));
    });
  });
  describe('burnStablecoin', () => {
    it('success - when non null balance', async () => {
      await agToken.connect(user).burnStablecoin(parseEther('0.3'));
      expect(await agToken.balanceOf(user.address)).to.be.equal(parseEther('0.7'));
    });
    it('reverts - when greater than balance', async () => {
      await expect(agToken.connect(user).burnStablecoin(parseEther('1.3'))).to.be.reverted;
    });
  });
  describe('burnSelf', () => {
    it('reverts - non minter', async () => {
      await expect(agToken.connect(user).burnSelf(parseEther('1'), user.address)).to.be.revertedWith('35');
    });
    it('success - when minter', async () => {
      await stableMaster.burnSelf(agToken.address, parseEther('0.4'), user.address);
      expect(await agToken.balanceOf(user.address)).to.be.equal(parseEther('0.6'));
      expect(await agToken.totalSupply()).to.be.equal(parseEther('0.6'));
    });
  });
  describe('burnFrom', () => {
    it('reverts - non minter', async () => {
      await expect(agToken.connect(user).burnFrom(parseEther('1'), user2.address, user.address)).to.be.revertedWith(
        '35',
      );
    });
    it('reverts - no approval', async () => {
      await expect(
        stableMaster.connect(user2).burnFrom(agToken.address, parseEther('1'), user.address, user2.address),
      ).to.be.revertedWith('23');
    });
    it('success - with approval', async () => {
      await agToken.connect(user).approve(user2.address, parseEther('2'));
      expect(await agToken.allowance(user.address, user2.address)).to.be.equal(parseEther('2'));
      await stableMaster.connect(user2).burnFrom(agToken.address, parseEther('0.5'), user.address, user2.address);
      expect(await agToken.balanceOf(user.address)).to.be.equal(parseEther('0.5'));
      expect(await agToken.allowance(user.address, user2.address)).to.be.equal(parseEther('1.5'));
    });
  });
  describe('addMinter', () => {
    it('reverts - non treasury', async () => {
      await expect(agToken.connect(user).addMinter(user.address)).to.be.revertedWith('1');
    });
    it('reverts - zero address', async () => {
      await expect(treasury.connect(user).addMinter(agToken.address, ZERO_ADDRESS)).to.be.revertedWith('0');
    });
    it('success - minter toggled', async () => {
      const receipt = await (await treasury.connect(user).addMinter(agToken.address, user.address)).wait();
      expect(await agToken.isMinter(user.address)).to.be.equal(true);
      inIndirectReceipt(
        receipt,
        new utils.Interface(['event MinterToggled(address indexed minter)']),
        'MinterToggled',
        {
          minter: user.address,
        },
      );
    });
  });
  describe('removeMinter', () => {
    it('reverts - non treasury', async () => {
      await expect(agToken.connect(user).removeMinter(user2.address)).to.be.revertedWith('36');
    });
    it('reverts - removing stableMaster from the treasury', async () => {
      await expect(treasury.connect(user).removeMinter(agToken.address, stableMaster.address)).to.be.revertedWith('36');
    });
    it('success - minter removed after being added', async () => {
      await (await treasury.connect(user).addMinter(agToken.address, user.address)).wait();
      expect(await agToken.isMinter(user.address)).to.be.equal(true);
      await expect(agToken.connect(user2).removeMinter(user.address)).to.be.revertedWith('36');
      const receipt = await (await treasury.connect(user).removeMinter(agToken.address, user.address)).wait();
      inIndirectReceipt(
        receipt,
        new utils.Interface(['event MinterToggled(address indexed minter)']),
        'MinterToggled',
        {
          minter: user.address,
        },
      );
    });
    it('success - minter removed after requesting it', async () => {
      await (await treasury.connect(user).addMinter(agToken.address, user.address)).wait();
      const receipt = await (await agToken.connect(user).removeMinter(user.address)).wait();
      inReceipt(receipt, 'MinterToggled', {
        minter: user.address,
      });
    });
  });
  describe('setTreasury', () => {
    it('reverts - non treasury', async () => {
      await expect(agToken.connect(user).setTreasury(user.address)).to.be.revertedWith('1');
    });
    it('success - treasury updated', async () => {
      const receipt = await (await treasury.connect(user).setTreasury(agToken.address, user.address)).wait();
      expect(await agToken.treasury()).to.be.equal(user.address);
      inIndirectReceipt(
        receipt,
        new utils.Interface(['event TreasuryUpdated(address indexed _treasury)']),
        'TreasuryUpdated',
        {
          _treasury: user.address,
        },
      );
    });
    it('success - treasury updated and reset', async () => {
      await (await treasury.connect(user).setTreasury(agToken.address, user.address)).wait();
      const receipt = await (await agToken.connect(user).setTreasury(treasury.address)).wait();
      expect(await agToken.treasury()).to.be.equal(treasury.address);
      inReceipt(receipt, 'TreasuryUpdated', {
        _treasury: treasury.address,
      });
    });
  });
});
