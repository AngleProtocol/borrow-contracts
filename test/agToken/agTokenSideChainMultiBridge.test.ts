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
  describe('recoverERC20', () => {});
});
