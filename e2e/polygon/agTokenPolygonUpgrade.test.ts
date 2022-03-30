import { CONTRACTS_ADDRESSES } from '@angleprotocol/sdk';
import { ProxyAdmin_Interface } from '@angleprotocol/sdk/dist/constants/interfaces';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { Signer, utils } from 'ethers';
import { parseEther } from 'ethers/lib/utils';
import hre, { contract, ethers, web3 } from 'hardhat';

import { expect } from '../../test/utils/chai-setup';
import { inIndirectReceipt, inReceipt } from '../../test/utils/expectEvent';
import { deployUpgradeable, ZERO_ADDRESS } from '../../test/utils/helpers';
import {
  AgToken,
  AgToken__factory,
  CoreBorrow,
  CoreBorrow__factory,
  FlashAngle,
  FlashAngle__factory,
  ProxyAdmin,
  Treasury,
  Treasury__factory,
  TokenPolygonUpgradeable,
  TokenPolygonUpgradeable__factory,
} from '../../typechain';

contract('TokenPolygonUpgradeable - End-to-end Upgrade', () => {
  let deployer: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let charlie: SignerWithAddress;

  let flashAngle: FlashAngle;
  let coreBorrow: CoreBorrow;
  let agToken: TokenPolygonUpgradeable;
  let treasury: Treasury;
  let governor: string;
  let guardian: string;
  let proxyAdmin: ProxyAdmin;
  let depositorRole: string;
  let governorRole: string;
  let flashloanerTreasuryRole: string;
  let stableMasterAddress: string;

  const impersonatedSigners: { [key: string]: Signer } = {};

  before(async () => {
    [deployer, alice, bob, charlie] = await ethers.getSigners();
    // Multisig address on Polygon
    guardian = '0xdA2D2f638D6fcbE306236583845e5822554c02EA';
    const impersonatedAddresses = [guardian];

    for (const address of impersonatedAddresses) {
      await hre.network.provider.request({
        method: 'hardhat_impersonateAccount',
        params: [address],
      });
      await hre.network.provider.send('hardhat_setBalance', [address, '0x10000000000000000000000000000']);
      impersonatedSigners[address] = await ethers.getSigner(address);
      depositorRole = web3.utils.keccak256('DEPOSITOR_ROLE');
    }
  });

  before(async () => {
    proxyAdmin = new ethers.Contract(
      '0xbfca293e17e067e8abdca30a5d35addd0cbae6d6',
      ProxyAdmin_Interface,
      deployer,
    ) as ProxyAdmin;

    const implementation = await new TokenPolygonUpgradeable__factory(deployer).deploy();
    // eslint-disable-next-line
    const agTokenAddress = '0xE0B52e49357Fd4DAf2c15e02058DCE6BC0057db4';

    await (
      await proxyAdmin.connect(impersonatedSigners[guardian]).upgrade(agTokenAddress, implementation.address)
    ).wait();

    agToken = new ethers.Contract(
      agTokenAddress,
      TokenPolygonUpgradeable__factory.createInterface(),
      deployer,
    ) as TokenPolygonUpgradeable;
    /*
    agToken = new ethers.Contract(agTokenAddress, AgToken__factory.createInterface(), deployer) as AgToken;
    coreBorrow = (await deployUpgradeable(new CoreBorrow__factory(deployer))) as CoreBorrow;
    await coreBorrow.initialize(governor, guardian);
    flashAngle = (await deployUpgradeable(new FlashAngle__factory(deployer))) as FlashAngle;
    await flashAngle.initialize(coreBorrow.address);
    await coreBorrow.connect(impersonatedSigners[governor]).setFlashLoanModule(flashAngle.address);

    treasury = (await deployUpgradeable(new Treasury__factory(deployer))) as Treasury;
    await treasury.initialize(coreBorrow.address, agToken.address);

    await agToken.connect(impersonatedSigners[governor]).setUpTreasury(treasury.address);
    await coreBorrow.connect(impersonatedSigners[governor]).addFlashLoanerTreasuryRole(treasury.address);
    */
  });
  describe('upgrade - References & Variables', () => {
    it('success - references', async () => {
      expect(await agToken.name()).to.be.equal('agEUR');
      expect(await agToken.symbol()).to.be.equal('agEUR');
      expect(await agToken.DEPOSITOR_ROLE()).to.be.equal(depositorRole);
    });
  });
  /*
  describe('upgrade - References & Variables', () => {
    it('success - coreBorrow', async () => {
      expect(await coreBorrow.flashLoanModule()).to.be.equal(flashAngle.address);
      expect(await coreBorrow.isGovernor(governor)).to.be.equal(true);
      expect(await coreBorrow.isGovernor(guardian)).to.be.equal(false);
      expect(await coreBorrow.isGovernorOrGuardian(guardian)).to.be.equal(true);
      expect(await coreBorrow.isGovernorOrGuardian(governor)).to.be.equal(true);
      expect(await coreBorrow.isFlashLoanerTreasury(treasury.address)).to.be.equal(true);
      expect(await coreBorrow.isFlashLoanerTreasury(guardian)).to.be.equal(false);
      expect(await coreBorrow.getRoleAdmin(guardianRole)).to.be.equal(guardianRole);
      expect(await coreBorrow.getRoleAdmin(governorRole)).to.be.equal(governorRole);
      expect(await coreBorrow.getRoleAdmin(flashloanerTreasuryRole)).to.be.equal(governorRole);
      expect(await coreBorrow.hasRole(guardianRole, guardian)).to.be.equal(true);
      expect(await coreBorrow.hasRole(guardianRole, governor)).to.be.equal(true);
      expect(await coreBorrow.hasRole(governorRole, governor)).to.be.equal(true);
      expect(await coreBorrow.hasRole(flashloanerTreasuryRole, governor)).to.be.equal(false);
      expect(await coreBorrow.hasRole(flashloanerTreasuryRole, treasury.address)).to.be.equal(true);
    });
    it('success - treasury', async () => {
      expect(await treasury.flashLoanModule()).to.be.equal(flashAngle.address);
      expect(await treasury.stablecoin()).to.be.equal(agToken.address);
      expect(await treasury.core()).to.be.equal(coreBorrow.address);
      expect(await treasury.surplusManager()).to.be.equal(ZERO_ADDRESS);
      expect(await treasury.isGovernor(governor)).to.be.equal(true);
      expect(await treasury.isGovernor(guardian)).to.be.equal(false);
      expect(await treasury.isGovernorOrGuardian(guardian)).to.be.equal(true);
      expect(await treasury.isGovernorOrGuardian(governor)).to.be.equal(true);
    });
    it('success - agToken', async () => {
      expect(await agToken.isMinter(flashAngle.address)).to.be.equal(true);
      expect(await agToken.isMinter(stableMasterAddress)).to.be.equal(true);
      expect(await agToken.treasury()).to.be.equal(treasury.address);
      expect(await agToken.treasuryInitialized()).to.be.equal(true);
      expect(await agToken.stableMaster()).to.be.equal(stableMasterAddress);
    });
    it('success - flashAngle', async () => {
      expect(await flashAngle.core()).to.be.equal(coreBorrow.address);
      expect((await flashAngle.stablecoinMap(agToken.address)).treasury).to.be.equal(treasury.address);
    });
    it('success - contracts initialized', async () => {
      await expect(coreBorrow.initialize(governor, guardian)).to.be.revertedWith(
        'Initializable: contract is already initialized',
      );
      await expect(treasury.initialize(governor, guardian)).to.be.revertedWith(
        'Initializable: contract is already initialized',
      );
      await expect(agToken.initialize('agEUR', 'agEUR', governor)).to.be.revertedWith(
        'Initializable: contract is already initialized',
      );
      await expect(flashAngle.initialize(governor)).to.be.revertedWith(
        'Initializable: contract is already initialized',
      );
    });
  });
  describe('addMinter', () => {
    it('success - minter added', async () => {
      const receipt = await (await treasury.connect(impersonatedSigners[governor]).addMinter(alice.address)).wait();
      expect(await agToken.isMinter(alice.address)).to.be.equal(true);
      inIndirectReceipt(
        receipt,
        new utils.Interface(['event MinterToggled(address indexed minter)']),
        'MinterToggled',
        {
          minter: alice.address,
        },
      );
    });
    it('reverts - zero address', async () => {
      await expect(treasury.connect(impersonatedSigners[governor]).addMinter(ZERO_ADDRESS)).to.be.revertedWith('0');
    });
    it('reverts - non treasury', async () => {
      await expect(agToken.addMinter(alice.address)).to.be.revertedWith('1');
    });
    it('success - can mint', async () => {
      await agToken.connect(alice).mint(alice.address, parseEther('1000'));
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('1000'));
    });
  });
  describe('burnSelf', () => {
    it('success - minter can burn', async () => {
      const receipt = await (await agToken.connect(alice).burnSelf(parseEther('500'), alice.address)).wait();
      inReceipt(receipt, 'Transfer', {
        from: alice.address,
        to: ZERO_ADDRESS,
        value: parseEther('500'),
      });
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('500'));
    });
    it('reverts - when non minter', async () => {
      await expect(agToken.connect(bob).burnSelf(parseEther('500'), alice.address)).to.be.revertedWith('35');
    });
  });
  describe('burnFrom', () => {
    it('reverts - when non minter', async () => {
      await expect(agToken.connect(bob).burnFrom(parseEther('500'), alice.address, bob.address)).to.be.revertedWith(
        '35',
      );
    });
    it('success - add other minter', async () => {
      const receipt = await (await treasury.connect(impersonatedSigners[governor]).addMinter(bob.address)).wait();
      expect(await agToken.isMinter(bob.address)).to.be.equal(true);
      inIndirectReceipt(
        receipt,
        new utils.Interface(['event MinterToggled(address indexed minter)']),
        'MinterToggled',
        {
          minter: bob.address,
        },
      );
    });
    it('reverts - too small allowance', async () => {
      await expect(agToken.connect(bob).burnFrom(parseEther('500'), alice.address, bob.address)).to.be.revertedWith(
        '23',
      );
    });
    it('success - when allowance', async () => {
      await agToken.connect(alice).approve(bob.address, parseEther('1000'));
      expect(await agToken.allowance(alice.address, bob.address)).to.be.equal(parseEther('1000'));
      const receipt = await (await agToken.connect(bob).burnFrom(parseEther('100'), alice.address, bob.address)).wait();
      inReceipt(receipt, 'Transfer', {
        from: alice.address,
        to: ZERO_ADDRESS,
        value: parseEther('100'),
      });
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('400'));
      expect(await agToken.allowance(alice.address, bob.address)).to.be.equal(parseEther('900'));
    });
  });
  describe('burnStablecoin', () => {
    it('reverts - when higher than balance', async () => {
      await expect(agToken.connect(alice).burnStablecoin(parseEther('500'))).to.be.reverted;
    });
    it('success - balance updated', async () => {
      const receipt = await (await agToken.connect(alice).burnStablecoin(parseEther('100'))).wait();
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('300'));
      inReceipt(receipt, 'Transfer', {
        from: alice.address,
        to: ZERO_ADDRESS,
        value: parseEther('100'),
      });
    });
  });
  describe('burnNoRedeem', () => {
    it('reverts - when higher than balance', async () => {
      await expect(agToken.connect(alice).burnNoRedeem(parseEther('500'), bob.address)).to.be.reverted;
    });
    it('reverts - when invalid poolManager', async () => {
      await expect(agToken.connect(alice).burnNoRedeem(parseEther('100'), bob.address)).to.be.reverted;
    });
    it('success - balance updated', async () => {
      // eslint-disable-next-line
      const poolManagerDAI = CONTRACTS_ADDRESSES[1].agEUR?.collaterals?.DAI.PoolManager!;
      const receipt = await (await agToken.connect(alice).burnNoRedeem(parseEther('100'), poolManagerDAI)).wait();
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('200'));
      inReceipt(receipt, 'Transfer', {
        from: alice.address,
        to: ZERO_ADDRESS,
        value: parseEther('100'),
      });
    });
  });
  describe('burnFromNoRedeem', () => {
    it('reverts - when higher than approval', async () => {
      await expect(agToken.connect(bob).burnFromNoRedeem(alice.address, parseEther('100000'), bob.address)).to.be
        .reverted;
    });
    it('reverts - when higher than balance', async () => {
      await expect(agToken.connect(bob).burnFromNoRedeem(alice.address, parseEther('201'), bob.address)).to.be.reverted;
    });
    it('reverts - when invalid poolManager', async () => {
      await expect(agToken.connect(bob).burnFromNoRedeem(alice.address, parseEther('100'), bob.address)).to.be.reverted;
    });
    it('success - balance updated', async () => {
      // eslint-disable-next-line
      const poolManagerDAI = CONTRACTS_ADDRESSES[1].agEUR?.collaterals?.DAI.PoolManager!;
      const receipt = await (
        await agToken.connect(bob).burnFromNoRedeem(alice.address, parseEther('100'), poolManagerDAI)
      ).wait();
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('100'));
      inReceipt(receipt, 'Transfer', {
        from: alice.address,
        to: ZERO_ADDRESS,
        value: parseEther('100'),
      });
    });
  });
  describe('removeMinter', () => {
    it('reverts - non minter', async () => {
      await expect(agToken.connect(charlie).removeMinter(alice.address)).to.be.revertedWith('36');
    });
    it('reverts - sender is treasury and address is stableMaster', async () => {
      await expect(
        treasury.connect(impersonatedSigners[governor]).removeMinter(stableMasterAddress),
      ).to.be.revertedWith('36');
    });
    it('success - from treasury', async () => {
      const receipt = await (await treasury.connect(impersonatedSigners[governor]).removeMinter(alice.address)).wait();
      inIndirectReceipt(
        receipt,
        new utils.Interface(['event MinterToggled(address indexed minter)']),
        'MinterToggled',
        {
          minter: alice.address,
        },
      );
      expect(await agToken.isMinter(alice.address)).to.be.equal(false);
    });
    it('success - from minter', async () => {
      const receipt = await (await agToken.connect(bob).removeMinter(bob.address)).wait();
      inReceipt(receipt, 'MinterToggled', {
        minter: bob.address,
      });
      expect(await agToken.isMinter(bob.address)).to.be.equal(false);
    });
  });
  describe('setTreasury', () => {
    it('reverts - non treasury', async () => {
      await expect(agToken.connect(charlie).setTreasury(alice.address)).to.be.revertedWith('1');
    });
    it('success - treasury updated', async () => {
      const newTreasury = (await deployUpgradeable(new Treasury__factory(deployer))) as Treasury;
      await newTreasury.initialize(coreBorrow.address, agToken.address);
      await coreBorrow.connect(impersonatedSigners[governor]).removeFlashLoanerTreasuryRole(treasury.address);
      const receipt = await (
        await treasury.connect(impersonatedSigners[governor]).setTreasury(newTreasury.address)
      ).wait();
      inReceipt(receipt, 'NewTreasurySet', {
        _treasury: newTreasury.address,
      });
      expect(await agToken.treasury()).to.be.equal(newTreasury.address);
    });
  });
  */
});
