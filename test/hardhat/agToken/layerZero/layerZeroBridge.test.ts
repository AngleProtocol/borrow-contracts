import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { Signer } from 'ethers';
import { parseEther } from 'ethers/lib/utils';
import hre, { contract, ethers, web3 } from 'hardhat';

import {
  LayerZeroBridge,
  LayerZeroBridge__factory,
  MockLayerZero,
  MockLayerZero__factory,
  MockTokenPermit,
  MockTokenPermit__factory,
  MockTreasury,
  MockTreasury__factory,
} from '../../../../typechain';
import { expect } from '../../utils/chai-setup';
import { inReceipt } from '../../utils/expectEvent';
import { deployUpgradeable, latestTime, ZERO_ADDRESS } from '../../utils/helpers';
import { signPermit } from '../../utils/sigUtils';

contract('LayerZeroBridge', () => {
  let deployer: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let remote: SignerWithAddress;

  let agToken: MockTokenPermit;
  let lzBridge: LayerZeroBridge;
  let lzEndpoint: MockLayerZero;
  let governor: string;
  let treasury: MockTreasury;

  const impersonatedSigners: { [key: string]: Signer } = {};

  before(async () => {
    [deployer, alice, bob, remote] = await ethers.getSigners();
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
    agToken = (await new MockTokenPermit__factory(deployer).deploy('agEUR', 'agEUR', 18)) as MockTokenPermit;
    lzEndpoint = (await new MockLayerZero__factory(deployer).deploy()) as MockLayerZero;

    lzBridge = (await deployUpgradeable(new LayerZeroBridge__factory(deployer))) as LayerZeroBridge;

    treasury = (await new MockTreasury__factory(deployer).deploy(
      agToken.address,
      governor,
      bob.address,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
    )) as MockTreasury;

    await lzBridge.initialize('LayerZero Bridge Token', lzEndpoint.address, treasury.address);
  });

  describe('initializer', () => {
    it('success - lzEndpoint, treasury, token', async () => {
      expect(await lzBridge.treasury()).to.be.equal(treasury.address);
      expect(await lzBridge.canonicalToken()).to.be.equal(agToken.address);
      expect(await lzBridge.lzEndpoint()).to.be.equal(lzEndpoint.address);
    });
    it('reverts - already initialized', async () => {
      await expect(
        lzBridge.initialize('LayerZero Bridge Token', lzEndpoint.address, treasury.address),
      ).to.be.revertedWith('Initializable: contract is already initialized');
    });
    it('reverts - zero address', async () => {
      const lzBridgeRevert = (await deployUpgradeable(new LayerZeroBridge__factory(deployer))) as LayerZeroBridge;
      await expect(
        lzBridgeRevert.initialize('LayerZero Bridge Token', ZERO_ADDRESS, treasury.address),
      ).to.be.revertedWith('ZeroAddress');
      await expect(
        lzBridgeRevert.initialize('LayerZero Bridge Token', lzEndpoint.address, ZERO_ADDRESS),
      ).to.be.revertedWith('ZeroAddress');
      await expect(lzBridgeRevert.initialize('LayerZero Bridge Token', ZERO_ADDRESS, ZERO_ADDRESS)).to.be.revertedWith(
        'ZeroAddress',
      );
    });
  });
  describe('name', () => {
    it('success - name', async () => {
      expect(await lzBridge.name()).to.be.equal('LayerZero Bridge Token');
    });
  });
  describe('Access Control', () => {
    it('reverts - non governor or guardian', async () => {
      await expect(lzBridge.pauseSendTokens(true)).to.be.revertedWith('NotGovernorOrGuardian');
      await expect(lzBridge.sweep(1, alice.address)).to.be.revertedWith('NotGovernorOrGuardian');
      await expect(lzBridge.setTrustedRemote(1, '0x')).to.be.revertedWith('NotGovernorOrGuardian');
      await expect(lzBridge.setConfig(1, 1, 1, '0x')).to.be.revertedWith('NotGovernorOrGuardian');
      await expect(lzBridge.setSendVersion(1)).to.be.revertedWith('NotGovernorOrGuardian');
      await expect(lzBridge.setReceiveVersion(1)).to.be.revertedWith('NotGovernorOrGuardian');
      await expect(lzBridge.forceResumeReceive(1, '0x')).to.be.revertedWith('NotGovernorOrGuardian');
    });
  });
  describe('pauseSendTokens', () => {
    it('success - pausing', async () => {
      await lzBridge.connect(impersonatedSigners[governor]).pauseSendTokens(true);
      await expect(lzBridge.connect(impersonatedSigners[governor]).pauseSendTokens(true)).to.be.revertedWith(
        'Pausable: paused',
      );
    });
    it('success - unpausing', async () => {
      await lzBridge.connect(impersonatedSigners[governor]).pauseSendTokens(true);
      await lzBridge.connect(impersonatedSigners[governor]).pauseSendTokens(false);
      await expect(lzBridge.connect(impersonatedSigners[governor]).pauseSendTokens(false)).to.be.revertedWith(
        'Pausable: not paused',
      );
    });
  });
  describe('setTrustedRemote', () => {
    it('success - trusted remote setup', async () => {
      expect(await lzBridge.isTrustedRemote(1, remote.address)).to.be.equal(false);
      const receipt = await (
        await lzBridge.connect(impersonatedSigners[governor]).setTrustedRemote(1, remote.address)
      ).wait();
      expect(await lzBridge.trustedRemoteLookup(1)).to.be.equal(remote.address.toLowerCase());
      inReceipt(receipt, 'SetTrustedRemote', {
        _srcChainId: 1,
        _srcAddress: remote.address.toLowerCase(),
      });
      expect(await lzBridge.isTrustedRemote(1, remote.address)).to.be.equal(true);
    });
  });
  describe('estimateSendFee', () => {
    it('success - mock contract is called', async () => {
      const receipt = await lzBridge.estimateSendFee(1, alice.address, 1, false, '0x');
      expect(receipt[0]).to.be.equal(123);
      expect(receipt[1]).to.be.equal(456);
    });
  });
  describe('setConfig', () => {
    it('success - config changed', async () => {
      await lzBridge.connect(impersonatedSigners[governor]).setConfig(1, 1, 67, '0x');
      expect(await lzEndpoint.config()).to.be.equal(67);
      await lzEndpoint.getConfig(0, 0, alice.address, 0);
      await lzBridge.getConfig(0, 0, alice.address, 0);
    });
  });
  describe('setSendVersion', () => {
    it('success - send version changed', async () => {
      await lzBridge.connect(impersonatedSigners[governor]).setSendVersion(10);
      expect(await lzEndpoint.sendVersion()).to.be.equal(10);
    });
  });
  describe('setReceiveVersion', () => {
    it('success - receive version changed', async () => {
      await lzBridge.connect(impersonatedSigners[governor]).setReceiveVersion(14);
      expect(await lzEndpoint.receiveVersion()).to.be.equal(14);
    });
  });
  describe('forceResumeReceive', () => {
    it('success - resumed', async () => {
      await lzBridge.connect(impersonatedSigners[governor]).forceResumeReceive(1, '0x');
      expect(await lzEndpoint.resumeReceived()).to.be.equal(1);
    });
    it('success - resumed and then paused', async () => {
      await lzBridge.connect(impersonatedSigners[governor]).forceResumeReceive(1, '0x');
      expect(await lzEndpoint.resumeReceived()).to.be.equal(1);
      await lzBridge.connect(impersonatedSigners[governor]).forceResumeReceive(1, '0x');
      expect(await lzEndpoint.resumeReceived()).to.be.equal(0);
    });
  });

  describe('send', () => {
    it('reverts - trusted remote not set', async () => {
      await agToken.mint(alice.address, parseEther('10'));
      await agToken.connect(alice).approve(lzBridge.address, parseEther('10'));
      await expect(
        lzBridge.connect(alice).send(1, bob.address, parseEther('1'), bob.address, ZERO_ADDRESS, '0x'),
      ).to.be.revertedWith('InvalidSource');
    });
    it('success - trusted remote set and message sent', async () => {
      await agToken.mint(alice.address, parseEther('10'));
      await lzBridge.connect(impersonatedSigners[governor]).setTrustedRemote(1, remote.address);
      await agToken.connect(alice).approve(lzBridge.address, parseEther('10'));
      await lzEndpoint.setOutBoundNonce(1, 10);
      expect(await lzEndpoint.getOutboundNonce(1, lzBridge.address)).to.be.equal(10);
      await lzBridge.connect(alice).send(1, bob.address, parseEther('1'), bob.address, ZERO_ADDRESS, '0x');
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('9'));
      expect(await agToken.balanceOf(lzBridge.address)).to.be.equal(parseEther('1'));
      expect(await agToken.allowance(alice.address, lzBridge.address)).to.be.equal(parseEther('9'));
      expect(await lzEndpoint.counters(1)).to.be.equal(1);
    });
    it('reverts - paused', async () => {
      await agToken.mint(alice.address, parseEther('10'));
      await lzBridge.connect(impersonatedSigners[governor]).setTrustedRemote(1, remote.address);
      await agToken.connect(alice).approve(lzBridge.address, parseEther('10'));
      await lzEndpoint.setOutBoundNonce(1, 10);
      expect(await lzEndpoint.getOutboundNonce(1, lzBridge.address)).to.be.equal(10);
      await lzBridge.connect(impersonatedSigners[governor]).pauseSendTokens(true);
      await expect(
        lzBridge.connect(alice).send(1, bob.address, parseEther('1'), bob.address, ZERO_ADDRESS, '0x'),
      ).to.be.revertedWith('Pausable: paused');
    });
  });

  describe('sendCredit', () => {
    it('reverts - trusted remote not set', async () => {
      await lzBridge.connect(impersonatedSigners[governor]).setTrustedRemote(1, remote.address);
      await agToken.mint(lzBridge.address, parseEther('1'));
      const payloadData = ethers.utils.defaultAbiCoder.encode(['bytes', 'uint256'], [alice.address, parseEther('3')]);
      await lzEndpoint.lzReceive(lzBridge.address, 1, remote.address, 0, payloadData);
      expect(await lzBridge.balanceOf(alice.address)).to.be.equal(parseEther('2'));
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('1'));
      await expect(
        lzBridge.connect(alice).sendCredit(9, bob.address, parseEther('1'), bob.address, ZERO_ADDRESS, '0x'),
      ).to.be.revertedWith('InvalidSource');
    });
    it('success - trusted remote set and message sent', async () => {
      await lzBridge.connect(impersonatedSigners[governor]).setTrustedRemote(1, remote.address);
      await lzEndpoint.setOutBoundNonce(1, 10);
      expect(await lzEndpoint.getOutboundNonce(1, lzBridge.address)).to.be.equal(10);
      await lzBridge.connect(impersonatedSigners[governor]).setTrustedRemote(1, remote.address);
      await agToken.mint(lzBridge.address, parseEther('1'));
      const payloadData = ethers.utils.defaultAbiCoder.encode(['bytes', 'uint256'], [alice.address, parseEther('3')]);
      await lzEndpoint.lzReceive(lzBridge.address, 1, remote.address, 0, payloadData);
      expect(await lzBridge.balanceOf(alice.address)).to.be.equal(parseEther('2'));
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('1'));
      await lzBridge.connect(alice).sendCredit(1, bob.address, parseEther('2'), bob.address, ZERO_ADDRESS, '0x');
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('1'));
      expect(await lzBridge.balanceOf(alice.address)).to.be.equal(parseEther('0'));
      expect(await lzEndpoint.counters(1)).to.be.equal(1);
    });
    it('reverts - paused', async () => {
      await lzBridge.connect(impersonatedSigners[governor]).setTrustedRemote(1, remote.address);
      await lzEndpoint.setOutBoundNonce(1, 10);
      expect(await lzEndpoint.getOutboundNonce(1, lzBridge.address)).to.be.equal(10);
      await lzBridge.connect(impersonatedSigners[governor]).setTrustedRemote(1, remote.address);
      await agToken.mint(lzBridge.address, parseEther('1'));
      const payloadData = ethers.utils.defaultAbiCoder.encode(['bytes', 'uint256'], [alice.address, parseEther('3')]);
      await lzEndpoint.lzReceive(lzBridge.address, 1, remote.address, 0, payloadData);
      expect(await lzBridge.balanceOf(alice.address)).to.be.equal(parseEther('2'));
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('1'));
      await lzBridge.connect(impersonatedSigners[governor]).pauseSendTokens(true);
      await expect(
        lzBridge.connect(alice).sendCredit(1, bob.address, parseEther('1'), bob.address, ZERO_ADDRESS, '0x'),
      ).to.be.revertedWith('Pausable: paused');
    });
  });

  describe('sendWithPermit', () => {
    it('success - trusted remote set and message sent', async () => {
      await agToken.mint(alice.address, parseEther('10'));
      const permitData = await signPermit(
        alice,
        0,
        agToken.address,
        (await latestTime()) + 1000,
        lzBridge.address,
        parseEther('1'),
        'agEUR',
      );
      await lzBridge.connect(impersonatedSigners[governor]).setTrustedRemote(1, remote.address);
      await lzBridge
        .connect(alice)
        .sendWithPermit(
          1,
          bob.address,
          parseEther('1'),
          bob.address,
          ZERO_ADDRESS,
          '0x',
          permitData.deadline,
          permitData.v,
          permitData.r,
          permitData.s,
        );
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('9'));
      expect(await agToken.balanceOf(lzBridge.address)).to.be.equal(parseEther('1'));
      expect(await agToken.allowance(alice.address, lzBridge.address)).to.be.equal(parseEther('0'));
      expect(await lzEndpoint.counters(1)).to.be.equal(1);
    });
    it('reverts - paused', async () => {
      await agToken.mint(alice.address, parseEther('10'));
      const permitData = await signPermit(
        alice,
        0,
        agToken.address,
        (await latestTime()) + 1000,
        lzBridge.address,
        parseEther('1'),
        'agEUR',
      );
      await lzBridge.connect(impersonatedSigners[governor]).setTrustedRemote(1, remote.address);
      await lzBridge.connect(impersonatedSigners[governor]).pauseSendTokens(true);
      await expect(
        lzBridge
          .connect(alice)
          .sendWithPermit(
            1,
            bob.address,
            parseEther('1'),
            bob.address,
            ZERO_ADDRESS,
            '0x',
            permitData.deadline,
            permitData.v,
            permitData.r,
            permitData.s,
          ),
      ).to.be.revertedWith('Pausable: paused');
    });
  });
  describe('nonblockingLzReceive', () => {
    it('reverts - InvalidCaller', async () => {
      await expect(lzBridge.nonblockingLzReceive(1, alice.address, 0, '0x')).to.be.revertedWith('InvalidCaller');
    });
  });

  describe('lzReceive', () => {
    it('reverts - invalid endpoint', async () => {
      await expect(lzBridge.lzReceive(1, alice.address, 0, '0x')).to.be.revertedWith('InvalidEndpoint');
    });
    it('reverts - invalid source', async () => {
      await expect(lzEndpoint.lzReceive(lzBridge.address, 1, alice.address, 0, '0x')).to.be.revertedWith(
        'InvalidSource',
      );
    });
    it('success - invalid payload but caught in the blocking lz receive', async () => {
      await lzBridge.connect(impersonatedSigners[governor]).setTrustedRemote(1, remote.address);
      await lzEndpoint.lzReceive(lzBridge.address, 1, remote.address, 0, deployer.address);
      expect(await lzBridge.failedMessages(1, remote.address, 0)).to.be.equal(web3.utils.keccak256(deployer.address));
    });
    it('success - no amount in the contract 1/2', async () => {
      await lzBridge.connect(impersonatedSigners[governor]).setTrustedRemote(1, remote.address);
      const payloadData = ethers.utils.defaultAbiCoder.encode(['bytes', 'uint256'], [alice.address, parseEther('1')]);
      await lzEndpoint.lzReceive(lzBridge.address, 1, remote.address, 0, payloadData);
      expect(await lzBridge.balanceOf(alice.address)).to.be.equal(parseEther('1'));
    });
    it('success - no amount in the contract 2/2', async () => {
      await lzBridge.connect(impersonatedSigners[governor]).setTrustedRemote(1, remote.address);
      const payloadData = ethers.utils.defaultAbiCoder.encode(['bytes', 'uint256'], [alice.address, parseEther('3')]);
      await lzEndpoint.lzReceive(lzBridge.address, 1, remote.address, 0, payloadData);
      expect(await lzBridge.balanceOf(alice.address)).to.be.equal(parseEther('3'));
    });
    it('success - a portion of stablecoins in the contract', async () => {
      await lzBridge.connect(impersonatedSigners[governor]).setTrustedRemote(1, remote.address);
      await agToken.mint(lzBridge.address, parseEther('1'));
      const payloadData = ethers.utils.defaultAbiCoder.encode(['bytes', 'uint256'], [alice.address, parseEther('3')]);
      await lzEndpoint.lzReceive(lzBridge.address, 1, remote.address, 0, payloadData);
      expect(await lzBridge.balanceOf(alice.address)).to.be.equal(parseEther('2'));
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('1'));
      expect(await agToken.balanceOf(lzBridge.address)).to.be.equal(parseEther('0'));
    });
    it('success - enough stablecoins in the contract', async () => {
      await lzBridge.connect(impersonatedSigners[governor]).setTrustedRemote(1, remote.address);
      await agToken.mint(lzBridge.address, parseEther('3'));
      const payloadData = ethers.utils.defaultAbiCoder.encode(['bytes', 'uint256'], [alice.address, parseEther('3')]);
      await lzEndpoint.lzReceive(lzBridge.address, 1, remote.address, 0, payloadData);
      expect(await lzBridge.balanceOf(alice.address)).to.be.equal(parseEther('0'));
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('3'));
      expect(await agToken.balanceOf(lzBridge.address)).to.be.equal(parseEther('0'));
    });
    it('success - when paused message is failed', async () => {
      await lzBridge.connect(impersonatedSigners[governor]).pauseSendTokens(true);
      await lzBridge.connect(impersonatedSigners[governor]).setTrustedRemote(1, remote.address);
      await agToken.mint(lzBridge.address, parseEther('3'));
      const payloadData = ethers.utils.defaultAbiCoder.encode(['bytes', 'uint256'], [alice.address, parseEther('3')]);
      await lzEndpoint.lzReceive(lzBridge.address, 1, remote.address, 0, payloadData);
      await lzBridge.connect(impersonatedSigners[governor]).pauseSendTokens(false);
      expect(await lzBridge.failedMessages(1, remote.address, 0)).to.be.equal(web3.utils.keccak256(payloadData));
    });
  });
  describe('retryMessage', () => {
    it('reverts - InvalidPayload', async () => {
      await expect(lzBridge.retryMessage(1, alice.address, 0, '0x')).to.be.revertedWith('InvalidPayload');
    });
    it('reverts - message retried and failed', async () => {
      await lzBridge.connect(impersonatedSigners[governor]).setTrustedRemote(1, remote.address);
      await lzEndpoint.lzReceive(lzBridge.address, 1, remote.address, 0, deployer.address);
      expect(await lzBridge.failedMessages(1, remote.address, 0)).to.be.equal(web3.utils.keccak256(deployer.address));
      await expect(lzBridge.retryMessage(1, remote.address, 0, deployer.address)).to.be.reverted;
    });
  });
  describe('withdraw', () => {
    it('reverts - paused', async () => {
      await lzBridge.connect(impersonatedSigners[governor]).pauseSendTokens(true);
      await expect(lzBridge.connect(alice).withdraw(parseEther('1'), alice.address)).to.be.revertedWith(
        'Pausable: paused',
      );
    });
    it('reverts - underflow', async () => {
      await expect(lzBridge.connect(alice).withdraw(parseEther('1'), alice.address)).to.be.reverted;
    });
    it('success - possible to withdraw part of the balance', async () => {
      await lzBridge.connect(impersonatedSigners[governor]).setTrustedRemote(1, remote.address);
      await agToken.mint(lzBridge.address, parseEther('1'));
      const payloadData = ethers.utils.defaultAbiCoder.encode(['bytes', 'uint256'], [alice.address, parseEther('3')]);
      await lzEndpoint.lzReceive(lzBridge.address, 1, remote.address, 0, payloadData);
      expect(await lzBridge.balanceOf(alice.address)).to.be.equal(parseEther('2'));
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('1'));
      await agToken.mint(lzBridge.address, parseEther('1'));
      await lzBridge.connect(alice).withdraw(parseEther('1'), alice.address);
      expect(await lzBridge.balanceOf(alice.address)).to.be.equal(parseEther('1'));
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('2'));
    });
    it('success - possible to withdraw all in a row', async () => {
      await lzBridge.connect(impersonatedSigners[governor]).setTrustedRemote(1, remote.address);
      await agToken.mint(lzBridge.address, parseEther('1'));
      const payloadData = ethers.utils.defaultAbiCoder.encode(['bytes', 'uint256'], [alice.address, parseEther('3')]);
      await lzEndpoint.lzReceive(lzBridge.address, 1, remote.address, 0, payloadData);
      expect(await lzBridge.balanceOf(alice.address)).to.be.equal(parseEther('2'));
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('1'));
      await agToken.mint(lzBridge.address, parseEther('10'));
      await lzBridge.connect(alice).withdraw(parseEther('2'), alice.address);
      expect(await lzBridge.balanceOf(alice.address)).to.be.equal(parseEther('0'));
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('3'));
      expect(await agToken.balanceOf(lzBridge.address)).to.be.equal(parseEther('8'));
    });
    it('success - withdraw to another address', async () => {
      await lzBridge.connect(impersonatedSigners[governor]).setTrustedRemote(1, remote.address);
      await agToken.mint(lzBridge.address, parseEther('1'));
      const payloadData = ethers.utils.defaultAbiCoder.encode(['bytes', 'uint256'], [alice.address, parseEther('3')]);
      await lzEndpoint.lzReceive(lzBridge.address, 1, remote.address, 0, payloadData);
      expect(await lzBridge.balanceOf(alice.address)).to.be.equal(parseEther('2'));
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('1'));
      await agToken.mint(lzBridge.address, parseEther('1.5'));
      await lzBridge.connect(alice).withdraw(parseEther('1.5'), bob.address);
      expect(await lzBridge.balanceOf(alice.address)).to.be.equal(parseEther('0.5'));
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('1'));
      expect(await agToken.balanceOf(bob.address)).to.be.equal(parseEther('1.5'));
    });
    it('success - withdraw to another address and balance leftover', async () => {
      await lzBridge.connect(impersonatedSigners[governor]).setTrustedRemote(1, remote.address);
      await agToken.mint(lzBridge.address, parseEther('1'));
      const payloadData = ethers.utils.defaultAbiCoder.encode(['bytes', 'uint256'], [alice.address, parseEther('3')]);
      await lzEndpoint.lzReceive(lzBridge.address, 1, remote.address, 0, payloadData);
      expect(await lzBridge.balanceOf(alice.address)).to.be.equal(parseEther('2'));
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('1'));
      await agToken.mint(lzBridge.address, parseEther('1.5'));
      await lzBridge.connect(alice).withdraw(parseEther('1'), bob.address);
      expect(await lzBridge.balanceOf(alice.address)).to.be.equal(parseEther('1'));
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('1'));
      expect(await agToken.balanceOf(bob.address)).to.be.equal(parseEther('1'));
      expect(await agToken.balanceOf(lzBridge.address)).to.be.equal(parseEther('0.5'));
    });
  });
  describe('withdrawFor', () => {
    it('reverts - paused', async () => {
      await lzBridge.connect(impersonatedSigners[governor]).pauseSendTokens(true);
      await expect(lzBridge.connect(alice).withdrawFor(parseEther('1'), alice.address)).to.be.revertedWith(
        'Pausable: paused',
      );
    });
    it('reverts - overflow', async () => {
      await expect(lzBridge.connect(alice).withdrawFor(parseEther('1'), bob.address)).to.be.reverted;
    });
    it('success - withdraw for another address', async () => {
      await lzBridge.connect(impersonatedSigners[governor]).setTrustedRemote(1, remote.address);
      await agToken.mint(lzBridge.address, parseEther('1'));
      const payloadData = ethers.utils.defaultAbiCoder.encode(['bytes', 'uint256'], [alice.address, parseEther('3')]);
      await lzEndpoint.lzReceive(lzBridge.address, 1, remote.address, 0, payloadData);
      expect(await lzBridge.balanceOf(alice.address)).to.be.equal(parseEther('2'));
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('1'));
      await agToken.mint(lzBridge.address, parseEther('1.5'));
      await lzBridge.connect(bob).withdrawFor(parseEther('1'), alice.address);
      expect(await lzBridge.balanceOf(alice.address)).to.be.equal(parseEther('1'));
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('2'));
      expect(await agToken.balanceOf(bob.address)).to.be.equal(parseEther('0'));
      expect(await agToken.balanceOf(lzBridge.address)).to.be.equal(parseEther('0.5'));
    });
    it('success - withdraw all for another address', async () => {
      await lzBridge.connect(impersonatedSigners[governor]).setTrustedRemote(1, remote.address);
      await agToken.mint(lzBridge.address, parseEther('1'));
      const payloadData = ethers.utils.defaultAbiCoder.encode(['bytes', 'uint256'], [alice.address, parseEther('3')]);
      await lzEndpoint.lzReceive(lzBridge.address, 1, remote.address, 0, payloadData);
      expect(await lzBridge.balanceOf(alice.address)).to.be.equal(parseEther('2'));
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('1'));
      await agToken.mint(lzBridge.address, parseEther('2'));
      await lzBridge.connect(bob).withdrawFor(parseEther('2'), alice.address);
      expect(await lzBridge.balanceOf(alice.address)).to.be.equal(parseEther('0'));
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('3'));
      expect(await agToken.balanceOf(bob.address)).to.be.equal(parseEther('0'));
    });
  });
  describe('sweep', () => {
    it('reverts - underflows', async () => {
      await expect(lzBridge.connect(impersonatedSigners[governor]).sweep(parseEther('1'), alice.address)).to.be
        .reverted;
    });
    it('success - partial amount swept', async () => {
      await lzBridge.connect(impersonatedSigners[governor]).setTrustedRemote(1, remote.address);
      await agToken.mint(lzBridge.address, parseEther('1'));
      const payloadData = ethers.utils.defaultAbiCoder.encode(['bytes', 'uint256'], [alice.address, parseEther('3')]);
      await lzEndpoint.lzReceive(lzBridge.address, 1, remote.address, 0, payloadData);
      expect(await lzBridge.balanceOf(alice.address)).to.be.equal(parseEther('2'));
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('1'));
      await lzBridge.connect(impersonatedSigners[governor]).sweep(parseEther('1'), alice.address);
      expect(await lzBridge.balanceOf(alice.address)).to.be.equal(parseEther('1'));
    });
    it('success - full amount amount swept', async () => {
      await lzBridge.connect(impersonatedSigners[governor]).setTrustedRemote(1, remote.address);
      await agToken.mint(lzBridge.address, parseEther('1'));
      const payloadData = ethers.utils.defaultAbiCoder.encode(['bytes', 'uint256'], [alice.address, parseEther('3')]);
      await lzEndpoint.lzReceive(lzBridge.address, 1, remote.address, 0, payloadData);
      expect(await lzBridge.balanceOf(alice.address)).to.be.equal(parseEther('2'));
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('1'));
      await lzBridge.connect(impersonatedSigners[governor]).sweep(parseEther('2'), alice.address);
      expect(await lzBridge.balanceOf(alice.address)).to.be.equal(parseEther('0'));
      await expect(lzBridge.connect(alice).withdraw(parseEther('1'), alice.address)).to.be.reverted;
    });
  });
  describe('supportsInterface', () => {
    it('success - correct result', async () => {
      const bytes4 = web3.utils.toHex('test');
      expect(await lzBridge.supportsInterface(bytes4)).to.be.equal(false);
    });
  });
});
