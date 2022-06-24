import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { Signer } from 'ethers';
import { parseEther, parseUnits } from 'ethers/lib/utils';
import hre, { contract, ethers } from 'hardhat';

import {
  AgToken,
  AgToken__factory,
  MockERC1271,
  MockERC1271__factory,
  MockOracle,
  MockOracle__factory,
  MockStableMaster,
  MockStableMaster__factory,
  MockToken,
  MockToken__factory,
  MockTreasury,
  MockTreasury__factory,
  VaultManager,
  VaultManager__factory,
} from '../../typechain';
import { expect } from '../utils/chai-setup';
import { inReceipt } from '../utils/expectEvent';
import { deployUpgradeable, latestTime, ZERO_ADDRESS } from '../utils/helpers';
import { domainSeparator, signPermitNFT } from '../utils/sigUtilsNFT';

contract('VaultManager - Permit', () => {
  let deployer: SignerWithAddress;
  let governor: SignerWithAddress;
  let guardian: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  let treasury: MockTreasury;
  let collateral: MockToken;
  let oracle: MockOracle;
  let stableMaster: MockStableMaster;
  let agToken: AgToken;
  let contractSigner: MockERC1271;
  let vaultManager: VaultManager;
  let name: string;

  const impersonatedSigners: { [key: string]: Signer } = {};

  const collatBase = 10;
  const yearlyRate = 1.05;
  const ratePerSecond = yearlyRate ** (1 / (365 * 24 * 3600)) - 1;
  const params = {
    debtCeiling: parseEther('100'),
    collateralFactor: 0.5e9,
    targetHealthFactor: 1.1e9,
    borrowFee: 0.1e9,
    interestRate: parseUnits(ratePerSecond.toFixed(27), 27),
    liquidationSurcharge: 0.9e9,
    maxLiquidationDiscount: 0.1e9,
    liquidationBooster: 0.1e9,
    whitelistingActivated: false,
    baseBoost: 1e9,
  };

  before(async () => {
    ({ deployer, alice, bob, governor, guardian } = await ethers.getNamedSigners());
    // add any addresses you want to impersonate here
    const impersonatedAddresses = [{ address: '0xdC4e6DFe07EFCa50a197DF15D9200883eF4Eb1c8', name: 'governor' }];

    for (const ob of impersonatedAddresses) {
      await hre.network.provider.request({
        method: 'hardhat_impersonateAccount',
        params: [ob.address],
      });

      await hre.network.provider.send('hardhat_setBalance', [ob.address, '0x10000000000000000000000000000']);

      impersonatedSigners[ob.name] = await ethers.getSigner(ob.address);
    }
  });

  beforeEach(async () => {
    // If the forked-network state needs to be reset between each test, run this
    // await network.provider.request({method: 'hardhat_reset', params: []});

    stableMaster = await new MockStableMaster__factory(deployer).deploy();

    agToken = (await deployUpgradeable(new AgToken__factory(deployer))) as AgToken;
    await agToken.connect(deployer).initialize('agEUR', 'agEUR', stableMaster.address);

    collateral = await new MockToken__factory(deployer).deploy('A', 'A', collatBase);

    vaultManager = (await deployUpgradeable(new VaultManager__factory(deployer), 0.1e9, 0.1e9)) as VaultManager;

    treasury = await new MockTreasury__factory(deployer).deploy(
      agToken.address,
      governor.address,
      guardian.address,
      vaultManager.address,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
    );
    await agToken.connect(impersonatedSigners.governor).setUpTreasury(treasury.address);
    await treasury.addMinter(agToken.address, vaultManager.address);

    contractSigner = (await new MockERC1271__factory(deployer).deploy()) as MockERC1271;

    oracle = await new MockOracle__factory(deployer).deploy(parseUnits('2', 18), treasury.address);
    await vaultManager.initialize(treasury.address, collateral.address, oracle.address, params, 'USDC/agEUR');
    await vaultManager.connect(guardian).togglePause();
    name = await vaultManager.name();
  });

  describe('permit - EOA', () => {
    it('success - allowance given', async () => {
      const permitData = await signPermitNFT(
        bob,
        0,
        vaultManager.address,
        (await latestTime()) + 1000,
        alice.address,
        true,
        name,
      );
      const receipt = await (
        await vaultManager
          .connect(bob)
          .permit(bob.address, alice.address, true, permitData.deadline, permitData.v, permitData.r, permitData.s)
      ).wait();
      inReceipt(receipt, 'ApprovalForAll', {
        owner: bob.address,
        operator: alice.address,
        approved: true,
      });
      expect(await vaultManager.isApprovedForAll(bob.address, alice.address)).to.be.equal(true);
    });
    it('success - signature made and then given to contract by another address', async () => {
      const permitData = await signPermitNFT(
        bob,
        0,
        vaultManager.address,
        (await latestTime()) + 1000,
        alice.address,
        true,
        name,
      );
      const receipt = await (
        await vaultManager
          .connect(alice)
          .permit(bob.address, alice.address, true, permitData.deadline, permitData.v, permitData.r, permitData.s)
      ).wait();
      inReceipt(receipt, 'ApprovalForAll', {
        owner: bob.address,
        operator: alice.address,
        approved: true,
      });
      expect(await vaultManager.isApprovedForAll(bob.address, alice.address)).to.be.equal(true);
    });
    it('success - allowance given and then revoked', async () => {
      const permitData = await signPermitNFT(
        bob,
        0,
        vaultManager.address,
        (await latestTime()) + 1000,
        alice.address,
        true,
        name,
      );
      await vaultManager
        .connect(bob)
        .permit(bob.address, alice.address, true, permitData.deadline, permitData.v, permitData.r, permitData.s);
      expect(await vaultManager.isApprovedForAll(bob.address, alice.address)).to.be.equal(true);
      const permitData2 = await signPermitNFT(
        bob,
        1,
        vaultManager.address,
        (await latestTime()) + 1000,
        alice.address,
        false,
        name,
      );
      const receipt = await (
        await vaultManager
          .connect(bob)
          .permit(bob.address, alice.address, false, permitData2.deadline, permitData2.v, permitData2.r, permitData2.s)
      ).wait();
      inReceipt(receipt, 'ApprovalForAll', {
        owner: bob.address,
        operator: alice.address,
        approved: false,
      });
      expect(await vaultManager.isApprovedForAll(bob.address, alice.address)).to.be.equal(false);
      expect(await vaultManager.nonces(bob.address)).to.be.equal(2);
    });
    it('success - allowance given and revoked from setApprovalForAll', async () => {
      const permitData = await signPermitNFT(
        bob,
        0,
        vaultManager.address,
        (await latestTime()) + 1000,
        alice.address,
        true,
        name,
      );
      await vaultManager
        .connect(bob)
        .permit(bob.address, alice.address, true, permitData.deadline, permitData.v, permitData.r, permitData.s);
      expect(await vaultManager.isApprovedForAll(bob.address, alice.address)).to.be.equal(true);
      await vaultManager.connect(bob).setApprovalForAll(alice.address, false);
      expect(await vaultManager.isApprovedForAll(bob.address, alice.address)).to.be.equal(false);
      expect(await vaultManager.nonces(bob.address)).to.be.equal(1);
    });
    it('success - allowance given from setApprovalForAll and revoked by signature', async () => {
      await vaultManager.connect(bob).setApprovalForAll(alice.address, true);
      expect(await vaultManager.isApprovedForAll(bob.address, alice.address)).to.be.equal(true);
      const permitData = await signPermitNFT(
        bob,
        0,
        vaultManager.address,
        (await latestTime()) + 1000,
        alice.address,
        false,
        name,
      );
      await vaultManager
        .connect(bob)
        .permit(bob.address, alice.address, false, permitData.deadline, permitData.v, permitData.r, permitData.s);
      expect(await vaultManager.isApprovedForAll(bob.address, alice.address)).to.be.equal(false);
      expect(await vaultManager.nonces(bob.address)).to.be.equal(1);
    });
    it('reverts - expired deadline', async () => {
      const permitData = await signPermitNFT(
        bob,
        0,
        vaultManager.address,
        (await latestTime()) - 1000,
        alice.address,
        false,
        name,
      );
      await expect(
        vaultManager
          .connect(bob)
          .permit(bob.address, alice.address, false, permitData.deadline, permitData.v, permitData.r, permitData.s),
      ).to.be.revertedWith('ExpiredDeadline');
    });
    it('reverts - invalid nonce (reusing same signature)', async () => {
      const permitData = await signPermitNFT(
        bob,
        0,
        vaultManager.address,
        (await latestTime()) + 1000,
        alice.address,
        true,
        name,
      );
      await vaultManager
        .connect(bob)
        .permit(bob.address, alice.address, true, permitData.deadline, permitData.v, permitData.r, permitData.s);
      expect(await vaultManager.isApprovedForAll(bob.address, alice.address)).to.be.equal(true);
      await expect(
        vaultManager
          .connect(bob)
          .permit(bob.address, alice.address, true, permitData.deadline, permitData.v, permitData.r, permitData.s),
      ).to.be.revertedWith('InvalidSignature');
    });
    it('reverts - invalid signature (because someone else signed)', async () => {
      const permitData = await signPermitNFT(
        alice,
        0,
        vaultManager.address,
        (await latestTime()) + 1000,
        alice.address,
        true,
        name,
      );
      await expect(
        vaultManager
          .connect(bob)
          .permit(bob.address, alice.address, true, permitData.deadline, permitData.v, permitData.r, permitData.s),
      ).to.be.revertedWith('InvalidSignature');
    });
    it('reverts - invalid v parameter', async () => {
      const permitData = await signPermitNFT(
        bob,
        0,
        vaultManager.address,
        (await latestTime()) + 1000,
        alice.address,
        true,
        name,
      );
      await expect(
        vaultManager
          .connect(bob)
          .permit(bob.address, alice.address, true, permitData.deadline, 26, permitData.r, permitData.s),
      ).to.be.revertedWith('InvalidSignature');
    });
    it('reverts - invalid s parameter', async () => {
      const permitData = await signPermitNFT(
        bob,
        0,
        vaultManager.address,
        (await latestTime()) + 1000,
        alice.address,
        true,
        name,
      );
      await expect(
        vaultManager
          .connect(bob)
          .permit(
            bob.address,
            alice.address,
            true,
            permitData.deadline,
            permitData.v,
            permitData.r,
            '0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFD576E7357A4501DDFE92F46681B20A0',
          ),
      ).to.be.revertedWith('InvalidSignature');
    });
    it('reverts - recovers zero address', async () => {
      const permitData = await signPermitNFT(
        bob,
        0,
        vaultManager.address,
        (await latestTime()) + 1000,
        alice.address,
        true,
        name,
      );
      await expect(
        vaultManager
          .connect(bob)
          .permit(
            bob.address,
            alice.address,
            true,
            permitData.deadline,
            permitData.v,
            '0x0000000000000000000000000000000000000000000000000000000000000000',
            '0x0000000000000000000000000000000000000000000000000000000000000000',
          ),
      ).to.be.revertedWith('InvalidSignature');
    });
    it('reverts - permit signed to caller', async () => {
      const permitData = await signPermitNFT(
        bob,
        0,
        vaultManager.address,
        (await latestTime()) + 1000,
        bob.address,
        true,
        name,
      );
      await expect(
        vaultManager
          .connect(bob)
          .permit(bob.address, bob.address, true, permitData.deadline, permitData.v, permitData.r, permitData.s),
      ).to.be.revertedWith('ApprovalToCaller');
    });
  });
  describe('permit - Smart Contract', () => {
    it('reverts - when interface is not supported ', async () => {
      const permitData = await signPermitNFT(
        bob,
        0,
        vaultManager.address,
        (await latestTime()) + 1000,
        alice.address,
        true,
        name,
      );
      await expect(
        vaultManager
          .connect(bob)
          .permit(agToken.address, alice.address, true, permitData.deadline, permitData.v, permitData.r, permitData.s),
      ).to.be.reverted;
    });
    it('reverts - when signature is incorrect', async () => {
      const permitData = await signPermitNFT(
        bob,
        0,
        vaultManager.address,
        (await latestTime()) + 1000,
        alice.address,
        true,
        name,
      );
      await expect(
        vaultManager
          .connect(bob)
          .permit(
            contractSigner.address,
            alice.address,
            true,
            permitData.deadline,
            permitData.v,
            permitData.r,
            permitData.s,
          ),
      ).to.be.revertedWith('InvalidSignature');
    });
    it('success - when mode is activated', async () => {
      await contractSigner.setMode(1);
      // Technically, we don't need to sign the data here, but at least it's in the good format
      const permitData = await signPermitNFT(
        bob,
        0,
        vaultManager.address,
        (await latestTime()) + 1000,
        alice.address,
        true,
        name,
      );
      const receipt = await (
        await vaultManager
          .connect(alice)
          .permit(
            contractSigner.address,
            alice.address,
            true,
            permitData.deadline,
            permitData.v,
            permitData.r,
            permitData.s,
          )
      ).wait();
      inReceipt(receipt, 'ApprovalForAll', {
        owner: contractSigner.address,
        operator: alice.address,
        approved: true,
      });
      expect(await vaultManager.isApprovedForAll(contractSigner.address, alice.address)).to.be.equal(true);
      expect(await vaultManager.nonces(contractSigner.address)).to.be.equal(1);
    });
    it('success - when mode is activated to revoke an approval', async () => {
      await contractSigner.setMode(1);
      // Technically, we don't need to sign the data here, but at least it's in the good format
      const permitData = await signPermitNFT(
        bob,
        0,
        vaultManager.address,
        (await latestTime()) + 1000,
        alice.address,
        true,
        name,
      );
      const receipt = await (
        await vaultManager
          .connect(alice)
          .permit(
            contractSigner.address,
            alice.address,
            true,
            permitData.deadline,
            permitData.v,
            permitData.r,
            permitData.s,
          )
      ).wait();
      inReceipt(receipt, 'ApprovalForAll', {
        owner: contractSigner.address,
        operator: alice.address,
        approved: true,
      });
      expect(await vaultManager.isApprovedForAll(contractSigner.address, alice.address)).to.be.equal(true);
      expect(await vaultManager.nonces(contractSigner.address)).to.be.equal(1);
      const receipt2 = await (
        await vaultManager
          .connect(alice)
          .permit(
            contractSigner.address,
            alice.address,
            false,
            permitData.deadline,
            permitData.v,
            permitData.r,
            permitData.s,
          )
      ).wait();
      inReceipt(receipt2, 'ApprovalForAll', {
        owner: contractSigner.address,
        operator: alice.address,
        approved: false,
      });
      expect(await vaultManager.isApprovedForAll(contractSigner.address, alice.address)).to.be.equal(false);
      expect(await vaultManager.nonces(contractSigner.address)).to.be.equal(2);
    });
  });
  describe('domainSeparator', () => {
    it('success - value correctly printed', async () => {
      const domainSeparatorOffChain = await domainSeparator(name, vaultManager.address, '1');
      expect(await vaultManager.DOMAIN_SEPARATOR()).to.be.equal(domainSeparatorOffChain);
    });
  });
});
