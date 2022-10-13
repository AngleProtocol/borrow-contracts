import { CONTRACTS_ADDRESSES } from '@angleprotocol/sdk';
import {
  ProxyAdmin_Interface,
  StableMasterFront_Interface,
  ERC20_Interface,
} from '@angleprotocol/sdk/dist/constants/interfaces';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { Signer } from 'ethers';
import { parseEther } from 'ethers/lib/utils';
import hre, { contract, ethers } from 'hardhat';

import { expect } from '../../test/hardhat/utils/chai-setup';
import { inReceipt } from '../../test/hardhat/utils/expectEvent';
import { ZERO_ADDRESS } from '../../test/hardhat/utils/helpers';
import { AgTokenIntermediateUpgrade, AgTokenIntermediateUpgrade__factory, ProxyAdmin } from '../../typechain';

contract('AgTokenIntermediateUpgrade - End-to-end Upgrade', () => {
  let deployer: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let charlie: SignerWithAddress;

  let agToken: AgTokenIntermediateUpgrade;
  let governor: string;
  let guardian: string;
  let proxyAdmin: ProxyAdmin;
  let stableMasterAddress: string;
  let poolManager: string;

  const impersonatedSigners: { [key: string]: Signer } = {};

  before(async () => {
    [deployer, alice, bob, charlie] = await ethers.getSigners();
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

  before(async () => {
    proxyAdmin = new ethers.Contract(CONTRACTS_ADDRESSES[1].ProxyAdmin!, ProxyAdmin_Interface, deployer) as ProxyAdmin;

    const implementation = await new AgTokenIntermediateUpgrade__factory(deployer).deploy();
    // eslint-disable-next-line
    const agTokenAddress = CONTRACTS_ADDRESSES[1].agEUR?.AgToken!;
    // eslint-disable-next-line
    stableMasterAddress = CONTRACTS_ADDRESSES[1].agEUR?.StableMaster!;
    poolManager = CONTRACTS_ADDRESSES[1].agEUR?.collaterals!['USDC'].PoolManager!;
    await (
      await proxyAdmin.connect(impersonatedSigners[governor]).upgrade(agTokenAddress, implementation.address)
    ).wait();
    agToken = new ethers.Contract(
      agTokenAddress,
      AgTokenIntermediateUpgrade__factory.createInterface(),
      deployer,
    ) as AgTokenIntermediateUpgrade;
    await agToken.connect(impersonatedSigners[governor]).setUpMinter();
  });

  describe('upgrade - References & Variables', () => {
    it('success - agToken', async () => {
      expect(await agToken.isMinter(governor)).to.be.equal(true);
      expect(await agToken.stableMaster()).to.be.equal(stableMasterAddress);
      // Uniswap agEUR-FEI
      expect(await agToken.balanceOf('0xf89ce5ed65737da8440411544b0499c9fad323b2')).to.be.gt(parseEther('1000000'));
      // Uniswap agEUR-FRAX
      expect(await agToken.balanceOf('0x8ce5796ef6b0c5918025bcf4f9ca908201b030b3')).to.be.gt(parseEther('1000000'));
      // Sushiswap agEUR-ANGLE
      expect(await agToken.balanceOf('0x1f4c763BdE1D4832B3EA0640e66Da00B98831355')).to.be.gt(parseEther('1000000'));
      // Balances are correct when being logged
    });
    it('success - contract initialized', async () => {
      await expect(agToken.initialize('agEUR', 'agEUR', governor)).to.be.revertedWith(
        'Initializable: contract is already initialized',
      );
    });
    it('success - balances to another address', async () => {
      await expect(agToken.initialize('agEUR', 'agEUR', governor)).to.be.revertedWith(
        'Initializable: contract is already initialized',
      );
    });
  });
  describe('addMinter', () => {
    it('reverts - non treasury', async () => {
      await expect(agToken.addMinter(alice.address)).to.be.revertedWith('35');
    });
    it('success - minter added', async () => {
      const receipt = await (await agToken.connect(impersonatedSigners[governor]).addMinter(alice.address)).wait();
      expect(await agToken.isMinter(alice.address)).to.be.equal(true);
      inReceipt(receipt, 'MinterToggled', {
        minter: alice.address,
      });
    });

    it('success - can mint', async () => {
      await agToken.connect(alice).mint(alice.address, parseEther('1000'));
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('1000'));
      await agToken.connect(impersonatedSigners[governor]).mint(governor, parseEther('1000'));
      expect(await agToken.balanceOf(governor)).to.be.equal(parseEther('1000'));
    });
  });
  describe('setUpMinter', () => {
    it('reverts - non governor', async () => {
      await expect(agToken.connect(alice).setUpMinter()).to.be.reverted;
    });
    it('success - when governor calls', async () => {
      const receipt = await (await agToken.connect(impersonatedSigners[governor]).setUpMinter()).wait();
      inReceipt(receipt, 'MinterToggled', {
        minter: governor,
      });
    });
  });

  describe('removeMinter', () => {
    it('reverts - non minter and non address', async () => {
      await expect(agToken.connect(charlie).removeMinter(alice.address)).to.be.revertedWith('36');
    });
    it('success - from right address', async () => {
      const receipt = await (await agToken.connect(alice).removeMinter(alice.address)).wait();
      inReceipt(receipt, 'MinterToggled', {
        minter: alice.address,
      });
      expect(await agToken.isMinter(alice.address)).to.be.equal(false);
    });
    it('reverts - from address but non minter', async () => {
      await expect(agToken.connect(alice).removeMinter(alice.address)).to.be.revertedWith('36');
      await expect(agToken.connect(charlie).removeMinter(charlie.address)).to.be.revertedWith('36');
    });
  });
  describe('burnSelf', () => {
    it('success - minter can burn for another address', async () => {
      const receipt = await (
        await agToken.connect(impersonatedSigners[governor]).burnSelf(parseEther('500'), alice.address)
      ).wait();
      inReceipt(receipt, 'Transfer', {
        from: alice.address,
        to: ZERO_ADDRESS,
        value: parseEther('500'),
      });
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('500'));
    });
    it('success - minter can burn for its address', async () => {
      const receipt = await (
        await agToken.connect(impersonatedSigners[governor]).burnSelf(parseEther('500'), governor)
      ).wait();
      inReceipt(receipt, 'Transfer', {
        from: governor,
        to: ZERO_ADDRESS,
        value: parseEther('500'),
      });
      expect(await agToken.balanceOf(governor)).to.be.equal(parseEther('500'));
    });
    it('reverts - when non minter', async () => {
      await expect(agToken.connect(bob).burnSelf(parseEther('500'), alice.address)).to.be.revertedWith('35');
    });
    it('success - when from StableMaster', async () => {
      const stableMaster = new ethers.Contract(stableMasterAddress, StableMasterFront_Interface, deployer);
      await stableMaster.connect(alice).burn(parseEther('50'), alice.address, bob.address, poolManager, 0);
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('450'));
    });
    it('success - when from StableMaster and address has no balance', async () => {
      const stableMaster = new ethers.Contract(stableMasterAddress, StableMasterFront_Interface, deployer);
      await expect(stableMaster.connect(bob).burn(parseEther('50'), bob.address, bob.address, poolManager, 0)).to.be
        .reverted;
    });
  });
  describe('burnFrom', () => {
    it('reverts - non minter', async () => {
      await expect(agToken.connect(bob).burnFrom(parseEther('500'), alice.address, bob.address)).to.be.revertedWith(
        '35',
      );
    });
    it('reverts - too small allowance', async () => {
      await expect(
        agToken.connect(impersonatedSigners[governor]).burnFrom(parseEther('100'), alice.address, bob.address),
      ).to.be.revertedWith('23');
    });
    it('success - when allowance', async () => {
      await agToken.connect(alice).approve(bob.address, parseEther('1000'));
      expect(await agToken.allowance(alice.address, bob.address)).to.be.equal(parseEther('1000'));
      const receipt = await (
        await agToken.connect(impersonatedSigners[governor]).burnFrom(parseEther('100'), alice.address, bob.address)
      ).wait();
      inReceipt(receipt, 'Transfer', {
        from: alice.address,
        to: ZERO_ADDRESS,
        value: parseEther('100'),
      });
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('350'));
      expect(await agToken.allowance(alice.address, bob.address)).to.be.equal(parseEther('900'));
    });
    it('reverts - from StableMaster when no allowance', async () => {
      const stableMaster = new ethers.Contract(stableMasterAddress, StableMasterFront_Interface, deployer);
      await expect(
        stableMaster.connect(charlie).burn(parseEther('50'), alice.address, charlie.address, poolManager, 0),
      ).to.be.revertedWith('23');
    });
    it('success - from StableMaster when allowance', async () => {
      await agToken.connect(alice).approve(charlie.address, parseEther('1000'));
      expect(await agToken.allowance(alice.address, charlie.address)).to.be.equal(parseEther('1000'));
      const stableMaster = new ethers.Contract(stableMasterAddress, StableMasterFront_Interface, deployer);
      await stableMaster.connect(charlie).burn(parseEther('50'), alice.address, bob.address, poolManager, 0);
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('300'));
      expect(await agToken.allowance(alice.address, charlie.address)).to.be.equal(parseEther('950'));
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
  describe('mint', () => {
    it('reverts - non minter', async () => {
      await expect(agToken.connect(bob).mint(alice.address, parseEther('100000'))).to.be.revertedWith('35');
    });
    it('success - from minter', async () => {
      const receipt = await (
        await agToken.connect(impersonatedSigners[governor]).mint(charlie.address, parseEther('100000'))
      ).wait();
      inReceipt(receipt, 'Transfer', {
        from: ZERO_ADDRESS,
        to: charlie.address,
        value: parseEther('100000'),
      });
      expect(await agToken.balanceOf(charlie.address)).to.be.equal(parseEther('100000'));
    });
    it('success - from granted minter', async () => {
      const receipt1 = await (await agToken.connect(impersonatedSigners[governor]).addMinter(charlie.address)).wait();
      expect(await agToken.isMinter(charlie.address)).to.be.equal(true);
      inReceipt(receipt1, 'MinterToggled', {
        minter: charlie.address,
      });
      const receipt = await (await agToken.connect(charlie).mint(charlie.address, parseEther('100000'))).wait();
      inReceipt(receipt, 'Transfer', {
        from: ZERO_ADDRESS,
        to: charlie.address,
        value: parseEther('100000'),
      });
      expect(await agToken.balanceOf(charlie.address)).to.be.equal(parseEther('200000'));
    });
    it('success - from stableMaster', async () => {
      // Bob address has some USDC and will spend here half of his balance
      const usdc = new ethers.Contract('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', ERC20_Interface, deployer);
      const stableMaster = new ethers.Contract(stableMasterAddress, StableMasterFront_Interface, deployer);
      await usdc.connect(bob).approve(stableMasterAddress, parseEther('1000'));
      const balance = await usdc.balanceOf(bob.address);
      const agEURBalance = await agToken.balanceOf(bob.address);
      // Burning all bob balance
      const poolManagerDAI = CONTRACTS_ADDRESSES[1].agEUR?.collaterals?.DAI.PoolManager!;
      await agToken.connect(bob).burnNoRedeem(agEURBalance, poolManagerDAI);
      // Minting stablecoin
      await stableMaster.connect(bob).mint(balance.div(2), bob.address, poolManager, 0);
    });
    it('success - from stableMaster to another address', async () => {
      // bob address has some USDC
      const usdc = new ethers.Contract('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', ERC20_Interface, deployer);
      const stableMaster = new ethers.Contract(stableMasterAddress, StableMasterFront_Interface, deployer);
      await usdc.connect(bob).approve(stableMasterAddress, parseEther('1000'));
      const balance = await usdc.balanceOf(bob.address);
      const agEURBalance = await agToken.balanceOf(bob.address);
      const poolManagerDAI = CONTRACTS_ADDRESSES[1].agEUR?.collaterals?.DAI.PoolManager!;
      await agToken.connect(bob).burnNoRedeem(agEURBalance, poolManagerDAI);
      await stableMaster.connect(bob).mint(balance, charlie.address, poolManager, 0);
    });
  });
});
