import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { Signer } from 'ethers';
import { parseEther, parseUnits } from 'ethers/lib/utils';
import hre, { contract, ethers, web3 } from 'hardhat';

import {
  LayerZeroBridgeToken,
  LayerZeroBridgeToken__factory,
  MockLayerZero,
  MockLayerZero__factory,
  MockTokenPermit,
  MockTokenPermit__factory,
  MockTreasury,
  MockTreasury__factory,
} from '../../../../typechain';
import { expect } from '../../utils/chai-setup';
import { inReceipt } from '../../utils/expectEvent';
import { deployUpgradeable, latestTime, MAX_UINT256, ZERO_ADDRESS } from '../../utils/helpers';
import { signPermit } from '../../utils/sigUtils';

contract('LayerZeroBridgeToken', () => {
  let deployer: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let remote: SignerWithAddress;

  let agToken: MockTokenPermit;
  let lzBridge: LayerZeroBridgeToken;
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

    lzBridge = (await deployUpgradeable(new LayerZeroBridgeToken__factory(deployer))) as LayerZeroBridgeToken;

    treasury = (await new MockTreasury__factory(deployer).deploy(
      agToken.address,
      governor,
      bob.address,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
    )) as MockTreasury;

    await lzBridge.initialize('lz-agEUR', 'lz-agEUR', lzEndpoint.address, treasury.address, parseEther('100'));
  });
  describe('initializer', () => {
    it('success - lzEndpoint, treasury, token', async () => {
      expect(await lzBridge.treasury()).to.be.equal(treasury.address);
      expect(await lzBridge.canonicalToken()).to.be.equal(agToken.address);
      expect(await lzBridge.lzEndpoint()).to.be.equal(lzEndpoint.address);
      expect(await lzBridge.name()).to.be.equal('lz-agEUR');
      expect(await lzBridge.symbol()).to.be.equal('lz-agEUR');
      expect(await lzBridge.balanceOf(agToken.address)).to.be.equal(parseEther('100'));
      expect(await lzBridge.allowance(lzBridge.address, agToken.address)).to.be.equal(MAX_UINT256);
    });
    it('reverts - already initialized', async () => {
      await expect(
        lzBridge.initialize('lz-agEUR', 'lz-agEUR', lzEndpoint.address, treasury.address, parseEther('100')),
      ).to.be.revertedWith('Initializable: contract is already initialized');
    });
    it('reverts - zero address', async () => {
      const lzBridgeRevert = (await deployUpgradeable(
        new LayerZeroBridgeToken__factory(deployer),
      )) as LayerZeroBridgeToken;
      await expect(
        lzBridgeRevert.initialize('lz-agEUR', 'lz-agEUR', ZERO_ADDRESS, treasury.address, parseEther('100')),
      ).to.be.revertedWith('ZeroAddress');
      await expect(
        lzBridgeRevert.initialize('lz-agEUR', 'lz-agEUR', lzEndpoint.address, ZERO_ADDRESS, parseEther('100')),
      ).to.be.revertedWith('ZeroAddress');
      await expect(
        lzBridgeRevert.initialize('lz-agEUR', 'lz-agEUR', ZERO_ADDRESS, ZERO_ADDRESS, parseEther('100')),
      ).to.be.revertedWith('ZeroAddress');
    });
  });

  describe('Access Control', () => {
    it('reverts - non governor or guardian', async () => {
      await expect(lzBridge.pauseSendTokens(true)).to.be.revertedWith('NotGovernorOrGuardian');
      await expect(lzBridge.mint(1)).to.be.revertedWith('NotGovernorOrGuardian');
      await expect(lzBridge.setUseCustomAdapterParams(1)).to.be.revertedWith('NotGovernorOrGuardian');
      await expect(lzBridge.setPrecrime(ZERO_ADDRESS)).to.be.revertedWith('NotGovernorOrGuardian');
      await expect(lzBridge.setMinDstGas(1, 1, 1)).to.be.revertedWith('NotGovernorOrGuardian');
      await expect(lzBridge.burn(1)).to.be.revertedWith('NotGovernorOrGuardian');
      await expect(lzBridge.setupAllowance()).to.be.revertedWith('NotGovernorOrGuardian');
      await expect(lzBridge.setTrustedRemote(1, '0x')).to.be.revertedWith('NotGovernorOrGuardian');
      await expect(lzBridge.setConfig(1, 1, 1, '0x')).to.be.revertedWith('NotGovernorOrGuardian');
      await expect(lzBridge.setSendVersion(1)).to.be.revertedWith('NotGovernorOrGuardian');
      await expect(lzBridge.setReceiveVersion(1)).to.be.revertedWith('NotGovernorOrGuardian');
      await expect(lzBridge.forceResumeReceive(1, '0x')).to.be.revertedWith('NotGovernorOrGuardian');
    });
  });
  describe('name', () => {
    it('success - name', async () => {
      expect(await lzBridge.name()).to.be.equal('lz-agEUR');
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
  describe('setUseCustomAdapterParams', () => {
    it('success - parameters set', async () => {
      await lzBridge.connect(impersonatedSigners[governor]).setUseCustomAdapterParams(1);
      expect(await lzBridge.useCustomAdapterParams()).to.be.equal(1);
      await lzBridge.connect(impersonatedSigners[governor]).setUseCustomAdapterParams(7);
      expect(await lzBridge.useCustomAdapterParams()).to.be.equal(7);
    });
  });
  describe('setPrecrime', () => {
    it('success - precrime parameter set', async () => {
      expect(await lzBridge.precrime()).to.be.equal(ZERO_ADDRESS);
      await lzBridge.connect(impersonatedSigners[governor]).setPrecrime(alice.address);
      expect(await lzBridge.precrime()).to.be.equal(alice.address);
      await lzBridge.connect(impersonatedSigners[governor]).setPrecrime(remote.address);
      expect(await lzBridge.precrime()).to.be.equal(remote.address);
    });
  });
  describe('setMinDstGas', () => {
    it('success - dst gas set', async () => {
      await expect(lzBridge.connect(impersonatedSigners[governor]).setMinDstGas(0, 0, 0)).to.be.revertedWith(
        'InvalidParams',
      );
      await lzBridge.connect(impersonatedSigners[governor]).setMinDstGas(0, 1, 2);
      expect(await lzBridge.minDstGasLookup(0, 1)).to.be.equal(2);
      await lzBridge.connect(impersonatedSigners[governor]).setMinDstGas(0, 1, 82222);
      expect(await lzBridge.minDstGasLookup(0, 1)).to.be.equal(82222);
    });
  });
  describe('estimateSendFee', () => {
    it('success - contract called', async () => {
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
  describe('nonblockingLzReceive', () => {
    it('reverts - InvalidCaller', async () => {
      await expect(lzBridge.nonblockingLzReceive(1, alice.address, 0, '0x')).to.be.revertedWith('InvalidCaller');
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
  describe('supportsInterface', () => {
    it('success - correct result', async () => {
      const bytes4 = web3.utils.toHex('test');
      expect(await lzBridge.supportsInterface(bytes4)).to.be.equal(false);
    });
  });
  describe('mint', () => {
    it('success - token minted', async () => {
      // There's already 100 in balance before the call
      await lzBridge.connect(impersonatedSigners[governor]).mint(parseEther('1'));
      expect(await lzBridge.balanceOf(agToken.address)).to.be.equal(parseEther('101'));
    });
  });
  describe('burn', () => {
    it('success - token burnt', async () => {
      // There's already 100 in balance before the call
      await lzBridge.connect(impersonatedSigners[governor]).burn(parseEther('13'));
      expect(await lzBridge.balanceOf(agToken.address)).to.be.equal(parseEther('87'));
    });
  });
  describe('setupAllowance', () => {
    it('success - allowance granted', async () => {
      await lzBridge.connect(impersonatedSigners[governor]).setupAllowance();
      expect(await lzBridge.allowance(lzBridge.address, agToken.address)).to.be.equal(MAX_UINT256);
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
    it('success - trusted remote set and message sent with no fees', async () => {
      await agToken.mint(alice.address, parseEther('10'));
      await lzBridge.connect(impersonatedSigners[governor]).setTrustedRemote(1, remote.address);
      await agToken.connect(alice).approve(lzBridge.address, parseEther('10'));
      await lzEndpoint.setOutBoundNonce(1, 10);
      expect(await lzEndpoint.getOutboundNonce(1, lzBridge.address)).to.be.equal(10);
      const agTokenTotalSupply = await agToken.totalSupply();
      await lzBridge.connect(alice).send(1, bob.address, parseEther('1'), bob.address, ZERO_ADDRESS, '0x');
      expect(await agToken.totalSupply()).to.be.equal(agTokenTotalSupply.sub(parseEther('1')));
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('9'));
      expect(await lzBridge.balanceOf(agToken.address)).to.be.equal(parseEther('99'));
      expect(await agToken.allowance(alice.address, lzBridge.address)).to.be.equal(parseEther('9'));
      expect(await lzEndpoint.counters(1)).to.be.equal(1);
    });
    it('reverts - with custom adapter params but invalid length', async () => {
      await agToken.mint(alice.address, parseEther('10'));
      await lzBridge.connect(impersonatedSigners[governor]).setTrustedRemote(1, remote.address);
      await agToken.connect(alice).approve(lzBridge.address, parseEther('10'));
      await lzEndpoint.setOutBoundNonce(1, 10);
      expect(await lzEndpoint.getOutboundNonce(1, lzBridge.address)).to.be.equal(10);
      await lzBridge.connect(impersonatedSigners[governor]).setUseCustomAdapterParams(1);
      await expect(
        lzBridge.connect(alice).send(1, bob.address, parseEther('1'), bob.address, ZERO_ADDRESS, '0xA1'),
      ).to.be.revertedWith('InvalidParams');
    });
    it('reverts - with insufficient gas', async () => {
      await agToken.mint(alice.address, parseEther('10'));
      await lzBridge.connect(impersonatedSigners[governor]).setTrustedRemote(1, remote.address);
      await agToken.connect(alice).approve(lzBridge.address, parseEther('10'));
      await lzEndpoint.setOutBoundNonce(1, 10);
      expect(await lzEndpoint.getOutboundNonce(1, lzBridge.address)).to.be.equal(10);
      await lzBridge.connect(impersonatedSigners[governor]).setUseCustomAdapterParams(1);
      const adapterParams = ethers.utils.solidityPack(['uint16', 'uint256'], [1, 10]);
      await expect(
        lzBridge.connect(alice).send(1, bob.address, parseEther('1'), bob.address, ZERO_ADDRESS, adapterParams),
      ).to.be.revertedWith('InsufficientGas');
      const adapterParams2 = ethers.utils.solidityPack(['uint16', 'uint256'], [1, 149999]);
      await expect(
        lzBridge.connect(alice).send(1, bob.address, parseEther('1'), bob.address, ZERO_ADDRESS, adapterParams2),
      ).to.be.revertedWith('InsufficientGas');
    });
    it('success - trusted remote set and message sent with no fees and custom params', async () => {
      await agToken.mint(alice.address, parseEther('10'));
      await lzBridge.connect(impersonatedSigners[governor]).setTrustedRemote(1, remote.address);
      await agToken.connect(alice).approve(lzBridge.address, parseEther('10'));
      await lzEndpoint.setOutBoundNonce(1, 10);
      expect(await lzEndpoint.getOutboundNonce(1, lzBridge.address)).to.be.equal(10);
      const agTokenTotalSupply = await agToken.totalSupply();
      await lzBridge.connect(impersonatedSigners[governor]).setUseCustomAdapterParams(1);
      const adapterParams = ethers.utils.solidityPack(['uint16', 'uint256'], [1, 200001]);
      // Tests with odd values
      await lzBridge.connect(impersonatedSigners[governor]).setMinDstGas(1, 1, 2);
      await lzBridge.connect(impersonatedSigners[governor]).setMinDstGas(2, 0, 10);
      await lzBridge.connect(alice).send(1, bob.address, parseEther('1'), bob.address, ZERO_ADDRESS, adapterParams);
      expect(await agToken.totalSupply()).to.be.equal(agTokenTotalSupply.sub(parseEther('1')));
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('9'));
      expect(await lzBridge.balanceOf(agToken.address)).to.be.equal(parseEther('99'));
      expect(await agToken.allowance(alice.address, lzBridge.address)).to.be.equal(parseEther('9'));
      expect(await lzEndpoint.counters(1)).to.be.equal(1);
    });
    it('success - reverts trusted remote set and message sent with no fees and small custom params', async () => {
      await agToken.mint(alice.address, parseEther('10'));
      await lzBridge.connect(impersonatedSigners[governor]).setTrustedRemote(1, remote.address);
      await agToken.connect(alice).approve(lzBridge.address, parseEther('10'));
      await lzEndpoint.setOutBoundNonce(1, 10);
      expect(await lzEndpoint.getOutboundNonce(1, lzBridge.address)).to.be.equal(10);
      await lzBridge.connect(impersonatedSigners[governor]).setUseCustomAdapterParams(1);
      await lzBridge.connect(impersonatedSigners[governor]).setMinDstGas(1, 0, 2);
      expect(await lzBridge.minDstGasLookup(1, 0)).to.be.equal(2);
      const adapterParams = ethers.utils.solidityPack(['uint16', 'uint256'], [1, 150001]);
      await expect(
        lzBridge.connect(alice).send(1, bob.address, parseEther('1'), bob.address, ZERO_ADDRESS, adapterParams),
      ).to.be.revertedWith('InsufficientGas');
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
    it('reverts - adapter params has a non null length but not using custom adapter params', async () => {
      await agToken.mint(alice.address, parseEther('10'));
      await lzBridge.connect(impersonatedSigners[governor]).setTrustedRemote(1, remote.address);
      await agToken.connect(alice).approve(lzBridge.address, parseEther('10'));
      await lzEndpoint.setOutBoundNonce(1, 10);
      expect(await lzEndpoint.getOutboundNonce(1, lzBridge.address)).to.be.equal(10);
      await expect(
        lzBridge.connect(alice).send(1, bob.address, parseEther('1'), bob.address, ZERO_ADDRESS, '0xA1'),
      ).to.be.revertedWith('InvalidParams');
    });
    it('success - trusted remote set and message sent with fees in the contract', async () => {
      await agToken.mint(alice.address, parseEther('10'));
      await lzBridge.connect(impersonatedSigners[governor]).setTrustedRemote(1, remote.address);
      await agToken.connect(alice).approve(lzBridge.address, parseEther('10'));
      await lzEndpoint.setOutBoundNonce(1, 10);
      await agToken.setFees(parseUnits('0.5', 9));
      expect(await lzEndpoint.getOutboundNonce(1, lzBridge.address)).to.be.equal(10);
      const agTokenTotalSupply = await agToken.totalSupply();
      await lzBridge.connect(alice).send(1, bob.address, parseEther('1'), bob.address, ZERO_ADDRESS, '0x');
      expect(await agToken.totalSupply()).to.be.equal(agTokenTotalSupply.sub(parseEther('1')));
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('9'));
      expect(await lzBridge.balanceOf(agToken.address)).to.be.equal(parseEther('99.5'));
      expect(await agToken.allowance(alice.address, lzBridge.address)).to.be.equal(parseEther('9'));
      expect(await lzEndpoint.counters(1)).to.be.equal(1);
      await lzBridge.connect(impersonatedSigners[governor]).setupAllowance();
    });
  });
  describe('sendCredit', () => {
    it('reverts - trusted remote not set', async () => {
      await lzBridge.connect(impersonatedSigners[governor]).setTrustedRemote(1, remote.address);
      const payloadData = ethers.utils.defaultAbiCoder.encode(['bytes', 'uint256'], [alice.address, parseEther('3')]);
      await agToken.recoverERC20(lzBridge.address, lzBridge.address, parseEther('2'));
      expect(await lzBridge.balanceOf(lzBridge.address)).to.be.equal(parseEther('2'));
      expect(await lzBridge.balanceOf(agToken.address)).to.be.equal(parseEther('98'));
      await lzEndpoint.lzReceive(lzBridge.address, 1, remote.address, 0, payloadData);
      expect(await lzBridge.balanceOf(alice.address)).to.be.equal(parseEther('2'));
      await expect(
        lzBridge.connect(alice).sendCredit(9, bob.address, parseEther('1'), bob.address, ZERO_ADDRESS, '0x'),
      ).to.be.revertedWith('InvalidSource');
    });
    it('success - trusted remote set and message sent', async () => {
      await lzBridge.connect(impersonatedSigners[governor]).setTrustedRemote(1, remote.address);
      const payloadData = ethers.utils.defaultAbiCoder.encode(['bytes', 'uint256'], [alice.address, parseEther('3')]);
      await agToken.recoverERC20(lzBridge.address, lzBridge.address, parseEther('2'));
      expect(await lzBridge.balanceOf(lzBridge.address)).to.be.equal(parseEther('2'));
      expect(await lzBridge.balanceOf(agToken.address)).to.be.equal(parseEther('98'));
      await lzEndpoint.lzReceive(lzBridge.address, 1, remote.address, 0, payloadData);
      expect(await lzBridge.balanceOf(alice.address)).to.be.equal(parseEther('2'));
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('3'));
      await lzBridge.connect(alice).sendCredit(1, bob.address, parseEther('2'), bob.address, ZERO_ADDRESS, '0x');
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('3'));
      expect(await lzBridge.balanceOf(alice.address)).to.be.equal(parseEther('0'));
      expect(await lzEndpoint.counters(1)).to.be.equal(1);
    });
    it('reverts - paused', async () => {
      await lzBridge.connect(impersonatedSigners[governor]).setTrustedRemote(1, remote.address);
      const payloadData = ethers.utils.defaultAbiCoder.encode(['bytes', 'uint256'], [alice.address, parseEther('3')]);
      await agToken.recoverERC20(lzBridge.address, lzBridge.address, parseEther('2'));
      expect(await lzBridge.balanceOf(lzBridge.address)).to.be.equal(parseEther('2'));
      expect(await lzBridge.balanceOf(agToken.address)).to.be.equal(parseEther('98'));
      await lzEndpoint.lzReceive(lzBridge.address, 1, remote.address, 0, payloadData);
      expect(await lzBridge.balanceOf(alice.address)).to.be.equal(parseEther('2'));
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
      const agTokenTotalSupply = await agToken.totalSupply();
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
      expect(await agToken.allowance(alice.address, lzBridge.address)).to.be.equal(parseEther('0'));
      expect(await lzEndpoint.counters(1)).to.be.equal(1);
      expect(await agToken.totalSupply()).to.be.equal(agTokenTotalSupply.sub(parseEther('1')));
      expect(await lzBridge.balanceOf(agToken.address)).to.be.equal(parseEther('99'));
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
    it('reverts - non null adapter params', async () => {
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
      await lzBridge.connect(impersonatedSigners[governor]).setUseCustomAdapterParams(1);
      await expect(
        lzBridge
          .connect(alice)
          .sendWithPermit(
            1,
            bob.address,
            parseEther('1'),
            bob.address,
            ZERO_ADDRESS,
            '0xA1',
            permitData.deadline,
            permitData.v,
            permitData.r,
            permitData.s,
          ),
      ).to.be.revertedWith('InvalidParams');
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
    it('success - when paused message is failed', async () => {
      await lzBridge.connect(impersonatedSigners[governor]).pauseSendTokens(true);
      await lzBridge.connect(impersonatedSigners[governor]).setTrustedRemote(1, remote.address);
      await agToken.mint(lzBridge.address, parseEther('3'));
      const payloadData = ethers.utils.defaultAbiCoder.encode(['bytes', 'uint256'], [alice.address, parseEther('3')]);
      await lzEndpoint.lzReceive(lzBridge.address, 1, remote.address, 0, payloadData);
      await lzBridge.connect(impersonatedSigners[governor]).pauseSendTokens(false);
      expect(await lzBridge.failedMessages(1, remote.address, 0)).to.be.equal(web3.utils.keccak256(payloadData));
    });
    it('success - swap took place and no fees', async () => {
      await lzBridge.connect(impersonatedSigners[governor]).setTrustedRemote(1, remote.address);
      const payloadData = ethers.utils.defaultAbiCoder.encode(['bytes', 'uint256'], [alice.address, parseEther('1')]);
      await lzEndpoint.lzReceive(lzBridge.address, 1, remote.address, 0, payloadData);
      expect(await lzBridge.balanceOf(alice.address)).to.be.equal(parseEther('0'));
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('1'));
    });
    it('success - swap took place and fees', async () => {
      await lzBridge.connect(impersonatedSigners[governor]).setTrustedRemote(1, remote.address);
      const payloadData = ethers.utils.defaultAbiCoder.encode(['bytes', 'uint256'], [alice.address, parseEther('1')]);
      await agToken.setFees(parseUnits('0.5', 9));
      await lzEndpoint.lzReceive(lzBridge.address, 1, remote.address, 0, payloadData);
      expect(await lzBridge.balanceOf(alice.address)).to.be.equal(parseEther('0'));
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('0.5'));
      expect(await lzBridge.balanceOf(agToken.address)).to.be.equal(parseEther('101'));
    });
    it('success - swap took place and no fees and lzBridge balance is not null', async () => {
      await lzBridge.connect(impersonatedSigners[governor]).setTrustedRemote(1, remote.address);
      const payloadData = ethers.utils.defaultAbiCoder.encode(['bytes', 'uint256'], [alice.address, parseEther('1')]);
      await agToken.recoverERC20(lzBridge.address, lzBridge.address, parseEther('2'));
      expect(await lzBridge.balanceOf(lzBridge.address)).to.be.equal(parseEther('2'));
      expect(await lzBridge.balanceOf(agToken.address)).to.be.equal(parseEther('98'));
      await lzEndpoint.lzReceive(lzBridge.address, 1, remote.address, 0, payloadData);
      expect(await lzBridge.balanceOf(alice.address)).to.be.equal(parseEther('2'));
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('1'));
    });
  });
  describe('withdraw', () => {
    it('success - transfer took place requested to another address', async () => {
      // First getting a non null balance for the asset
      await lzBridge.connect(impersonatedSigners[governor]).setTrustedRemote(1, remote.address);
      const payloadData = ethers.utils.defaultAbiCoder.encode(['bytes', 'uint256'], [alice.address, parseEther('1')]);
      await agToken.recoverERC20(lzBridge.address, lzBridge.address, parseEther('2'));
      expect(await lzBridge.balanceOf(lzBridge.address)).to.be.equal(parseEther('2'));
      expect(await lzBridge.balanceOf(agToken.address)).to.be.equal(parseEther('98'));
      await lzEndpoint.lzReceive(lzBridge.address, 1, remote.address, 0, payloadData);
      expect(await lzBridge.balanceOf(alice.address)).to.be.equal(parseEther('2'));
      await lzBridge.connect(alice).withdraw(parseEther('1'), bob.address);
      expect(await lzBridge.balanceOf(alice.address)).to.be.equal(parseEther('1'));
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('1'));
      expect(await agToken.balanceOf(bob.address)).to.be.equal(parseEther('1'));
    });
    it('success - partial withdrawal', async () => {
      // First getting a non null balance for the asset
      await lzBridge.connect(impersonatedSigners[governor]).setTrustedRemote(1, remote.address);
      const payloadData = ethers.utils.defaultAbiCoder.encode(['bytes', 'uint256'], [alice.address, parseEther('1')]);
      await agToken.recoverERC20(lzBridge.address, lzBridge.address, parseEther('1'));
      expect(await lzBridge.balanceOf(lzBridge.address)).to.be.equal(parseEther('1'));
      await lzEndpoint.lzReceive(lzBridge.address, 1, remote.address, 0, payloadData);
      expect(await lzBridge.balanceOf(alice.address)).to.be.equal(parseEther('1'));
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('1'));
      await agToken.recoverERC20(lzBridge.address, lzBridge.address, parseEther('1'));
      expect(await lzBridge.balanceOf(lzBridge.address)).to.be.equal(parseEther('1'));
      await lzBridge.connect(alice).withdraw(parseEther('1'), bob.address);
      expect(await lzBridge.balanceOf(alice.address)).to.be.equal(parseEther('1'));
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('1'));
    });
    it('success - transfer and swap in took place', async () => {
      // First getting a non null balance for the asset
      await lzBridge.connect(impersonatedSigners[governor]).setTrustedRemote(1, remote.address);
      const payloadData = ethers.utils.defaultAbiCoder.encode(['bytes', 'uint256'], [alice.address, parseEther('1')]);
      await agToken.recoverERC20(lzBridge.address, lzBridge.address, parseEther('2'));
      expect(await lzBridge.balanceOf(lzBridge.address)).to.be.equal(parseEther('2'));
      await lzEndpoint.lzReceive(lzBridge.address, 1, remote.address, 0, payloadData);
      expect(await lzBridge.balanceOf(alice.address)).to.be.equal(parseEther('2'));
      await lzBridge.connect(alice).withdraw(parseEther('1'), alice.address);
      expect(await lzBridge.balanceOf(alice.address)).to.be.equal(parseEther('1'));
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('2'));
    });
  });
});
