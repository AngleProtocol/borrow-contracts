import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BigNumber } from 'ethers';
import { parseEther } from 'ethers/lib/utils';
import { contract, ethers, web3 } from 'hardhat';
import { MerkleTree } from 'merkletreejs';

import {
  MerkleRootDistributorV2,
  MerkleRootDistributorV2__factory,
  MockToken,
  MockToken__factory,
  MockTreasury,
  MockTreasury__factory,
} from '../../typechain';
import { expect } from '../utils/chai-setup';
import { inReceipt } from '../utils/expectEvent';
import { deployUpgradeable, MerkleTreeType, ZERO_ADDRESS } from '../utils/helpers';

contract('MerkleRootDistributor', () => {
  let deployer: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let governor: SignerWithAddress;
  let guardian: SignerWithAddress;
  let angle: MockToken;

  let distributor: MerkleRootDistributorV2;
  let treasury: MockTreasury;
  let merkleTree: MerkleTreeType;

  beforeEach(async () => {
    [deployer, alice, bob, governor, guardian] = await ethers.getSigners();
    angle = (await new MockToken__factory(deployer).deploy('ANGLE', 'ANGLE', 18)) as MockToken;
    treasury = await new MockTreasury__factory(deployer).deploy(
      angle.address,
      governor.address,
      guardian.address,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
    );
    distributor = (await deployUpgradeable(new MerkleRootDistributorV2__factory(deployer))) as MerkleRootDistributorV2;
    await distributor.initialize(treasury.address);
    merkleTree = { merkleRoot: web3.utils.keccak256('MERKLE_ROOT'), ipfsHash: web3.utils.keccak256('IPFS_HASH') };
  });
  describe('initializer', () => {
    it('success - treasury', async () => {
      expect(await distributor.treasury()).to.be.equal(treasury.address);
    });
    it('reverts - already initialized', async () => {
      await expect(distributor.initialize(treasury.address)).to.be.revertedWith(
        'Initializable: contract is already initialized',
      );
    });
    it('reverts - zero address', async () => {
      const distributorRevert = (await deployUpgradeable(
        new MerkleRootDistributorV2__factory(deployer),
      )) as MerkleRootDistributorV2;
      await expect(distributorRevert.initialize(ZERO_ADDRESS)).to.be.reverted;
    });
  });
  describe('toggleTrusted', () => {
    it('reverts - not guardian', async () => {
      await expect(distributor.connect(alice).toggleTrusted(bob.address)).to.be.revertedWith('NotGovernorOrGuardian');
    });
    it('success - trusted updated', async () => {
      expect(await distributor.trusted(bob.address)).to.be.equal(0);
      const receipt = await (await distributor.connect(guardian).toggleTrusted(bob.address)).wait();
      expect(await distributor.trusted(bob.address)).to.be.equal(1);
      inReceipt(receipt, 'TrustedToggled', {
        eoa: bob.address,
        trust: true,
      });
    });
    it('success - trusted updated and then removed', async () => {
      await (await distributor.connect(guardian).toggleTrusted(bob.address)).wait();
      const receipt = await (await distributor.connect(guardian).toggleTrusted(bob.address)).wait();
      inReceipt(receipt, 'TrustedToggled', {
        eoa: bob.address,
        trust: false,
      });
      expect(await distributor.trusted(bob.address)).to.be.equal(0);
    });
  });
  describe('toggleWhitelist', () => {
    it('reverts - not authorized', async () => {
      await expect(distributor.connect(alice).toggleWhitelist(bob.address)).to.be.revertedWith('NotTrusted');
    });
    it('success - whitelist updated - call by guardian', async () => {
      expect(await distributor.whitelist(bob.address)).to.be.equal(0);
      const receipt = await (await distributor.connect(guardian).toggleWhitelist(bob.address)).wait();
      expect(await distributor.whitelist(bob.address)).to.be.equal(1);
      inReceipt(receipt, 'WhitelistToggled', {
        user: bob.address,
        isEnabled: true,
      });
    });
    it('success - whitelist updated - call by user', async () => {
      await (await distributor.connect(bob).toggleWhitelist(bob.address)).wait();
      expect(await distributor.whitelist(bob.address)).to.be.equal(1);
      const receipt = await (await distributor.connect(bob).toggleWhitelist(bob.address)).wait();
      expect(await distributor.whitelist(bob.address)).to.be.equal(0);
      inReceipt(receipt, 'WhitelistToggled', {
        user: bob.address,
        isEnabled: false,
      });
    });
  });
  describe('toggleOperator', () => {
    it('reverts - not authorized', async () => {
      await expect(distributor.connect(alice).toggleOperator(bob.address, alice.address)).to.be.revertedWith(
        'NotTrusted',
      );
    });
    it('success - whitelist updated - call by guardian', async () => {
      expect(await distributor.operators(bob.address, alice.address)).to.be.equal(0);
      const receipt = await (await distributor.connect(guardian).toggleOperator(bob.address, alice.address)).wait();
      expect(await distributor.operators(bob.address, alice.address)).to.be.equal(1);
      inReceipt(receipt, 'OperatorToggled', {
        user: bob.address,
        operator: alice.address,
        isWhitelisted: true,
      });
    });
    it('success - whitelist updated - call by user', async () => {
      await (await distributor.connect(guardian).toggleOperator(bob.address, alice.address)).wait();
      expect(await distributor.operators(bob.address, alice.address)).to.be.equal(1);
      const receipt = await (await distributor.connect(bob).toggleOperator(bob.address, alice.address)).wait();
      expect(await distributor.operators(bob.address, alice.address)).to.be.equal(0);
      inReceipt(receipt, 'OperatorToggled', {
        user: bob.address,
        operator: alice.address,
        isWhitelisted: false,
      });
    });
  });
  describe('recoverERC20', () => {
    it('reverts - not guardian', async () => {
      await expect(
        distributor.connect(alice).recoverERC20(angle.address, bob.address, parseEther('1')),
      ).to.be.revertedWith('NotGovernorOrGuardian');
    });
    it('reverts - insufficient amount in contract', async () => {
      await expect(distributor.connect(guardian).recoverERC20(angle.address, bob.address, parseEther('1'))).to.be
        .reverted;
    });
    it('success - amount received', async () => {
      await angle.mint(distributor.address, parseEther('2'));
      const receipt = await (
        await distributor.connect(guardian).recoverERC20(angle.address, bob.address, parseEther('0.5'))
      ).wait();
      inReceipt(receipt, 'Recovered', {
        token: angle.address,
        to: bob.address,
        amount: parseEther('0.5'),
      });
      expect(await angle.balanceOf(bob.address)).to.be.equal(parseEther('0.5'));
      expect(await angle.balanceOf(distributor.address)).to.be.equal(parseEther('1.5'));
    });
  });
  describe('updateTree', () => {
    it('reverts - NotTrusted', async () => {
      await expect(distributor.connect(alice).updateTree(merkleTree)).to.be.revertedWith('NotTrusted');
    });
    it('success - from a governance address', async () => {
      const receipt = await (await distributor.connect(guardian).updateTree(merkleTree)).wait();
      inReceipt(receipt, 'TreeUpdated', {
        merkleRoot: web3.utils.keccak256('MERKLE_ROOT'),
        ipfsHash: web3.utils.keccak256('IPFS_HASH'),
      });
      expect((await distributor.tree()).merkleRoot).to.be.equal(web3.utils.keccak256('MERKLE_ROOT'));
      expect((await distributor.tree()).ipfsHash).to.be.equal(web3.utils.keccak256('IPFS_HASH'));
    });
    it('success - from a trusted address', async () => {
      await distributor.connect(guardian).toggleTrusted(bob.address);
      const receipt = await (await distributor.connect(bob).updateTree(merkleTree)).wait();
      inReceipt(receipt, 'TreeUpdated', {
        merkleRoot: web3.utils.keccak256('MERKLE_ROOT'),
        ipfsHash: web3.utils.keccak256('IPFS_HASH'),
      });
      expect((await distributor.tree()).merkleRoot).to.be.equal(web3.utils.keccak256('MERKLE_ROOT'));
      expect((await distributor.tree()).ipfsHash).to.be.equal(web3.utils.keccak256('IPFS_HASH'));
    });
  });
  describe('claim', () => {
    it('reverts - invalid length', async () => {
      await expect(
        distributor.claim(
          [alice.address, bob.address],
          [angle.address],
          [parseEther('1')],
          [[web3.utils.keccak256('test')]],
        ),
      ).to.be.revertedWith('InvalidLength');
      await expect(
        distributor.claim(
          [alice.address],
          [angle.address, angle.address],
          [parseEther('1')],
          [[web3.utils.keccak256('test')]],
        ),
      ).to.be.revertedWith('InvalidLength');
      await expect(
        distributor.claim(
          [alice.address],
          [angle.address],
          [parseEther('1'), parseEther('1')],
          [[web3.utils.keccak256('test')]],
        ),
      ).to.be.revertedWith('InvalidLength');
      await expect(
        distributor.claim(
          [alice.address],
          [angle.address],
          [parseEther('1')],
          [[web3.utils.keccak256('test')], [web3.utils.keccak256('test')]],
        ),
      ).to.be.revertedWith('InvalidLength');
      await expect(
        distributor.claim([], [angle.address], [parseEther('1')], [[web3.utils.keccak256('test')]]),
      ).to.be.revertedWith('InvalidLength');
    });
    it('reverts - invalid proof', async () => {
      await expect(
        distributor.claim([alice.address], [angle.address], [parseEther('1')], [[web3.utils.keccak256('test')]]),
      ).to.be.revertedWith('InvalidProof');
    });
    it('reverts - small proof on one token but no token balance', async () => {
      const elements = [];
      const file = {
        '0x3931C80BF7a911fcda8b684b23A433D124b59F06': parseEther('1'),
        '0x8f02b4a44Eacd9b8eE7739aa0BA58833DD45d002': parseEther('0.5'),
      };
      const fileProcessed = file as { [name: string]: BigNumber };
      const keys = Object.keys(fileProcessed);
      for (const key in keys) {
        const bytesPassed = ethers.utils.defaultAbiCoder.encode(
          ['address', 'address', 'uint256'],
          [keys[key], angle.address, fileProcessed[keys[key]]],
        );
        const hash = web3.utils.keccak256(bytesPassed);
        elements.push(hash);
      }

      const leaf = elements[0];
      const merkleTreeLib = new MerkleTree(elements, web3.utils.keccak256, { hashLeaves: false, sortPairs: true });
      const root = merkleTreeLib.getHexRoot();
      const proof = merkleTreeLib.getHexProof(leaf);
      await angle.mint(distributor.address, 10000);
      merkleTree.merkleRoot = root;
      await distributor.connect(guardian).updateTree(merkleTree);

      await expect(
        distributor.claim(['0x3931C80BF7a911fcda8b684b23A433D124b59F06'], [angle.address], [parseEther('1')], [proof]),
      ).to.be.reverted;
    });
    it('reverts - whitelist', async () => {
      const elements = [];
      const file = {
        '0x3931C80BF7a911fcda8b684b23A433D124b59F06': parseEther('1'),
        '0x8f02b4a44Eacd9b8eE7739aa0BA58833DD45d002': parseEther('0.5'),
      };
      const fileProcessed = file as { [name: string]: BigNumber };
      const keys = Object.keys(fileProcessed);
      for (const key in keys) {
        const bytesPassed = ethers.utils.defaultAbiCoder.encode(
          ['address', 'address', 'uint256'],
          [keys[key], angle.address, fileProcessed[keys[key]]],
        );
        const hash = web3.utils.keccak256(bytesPassed);
        elements.push(hash);
      }
      const leaf = elements[0];
      const merkleTreeLib = new MerkleTree(elements, web3.utils.keccak256, { hashLeaves: false, sortPairs: true });
      const root = merkleTreeLib.getHexRoot();
      const proof = merkleTreeLib.getHexProof(leaf);
      await angle.mint(distributor.address, parseEther('10'));
      merkleTree.merkleRoot = root;
      await distributor.connect(guardian).updateTree(merkleTree);

      await (await distributor.connect(guardian).toggleWhitelist('0x3931C80BF7a911fcda8b684b23A433D124b59F06')).wait();
      await expect(
        distributor
          .connect(bob)
          .claim(['0x3931C80BF7a911fcda8b684b23A433D124b59F06'], [angle.address], [parseEther('1')], [proof]),
      ).to.be.revertedWith('NotWhitelisted');
    });
    it('success - whitelist', async () => {
      const elements = [];
      const file = {
        '0x3931C80BF7a911fcda8b684b23A433D124b59F06': parseEther('1'),
        '0x8f02b4a44Eacd9b8eE7739aa0BA58833DD45d002': parseEther('0.5'),
      };
      const fileProcessed = file as { [name: string]: BigNumber };
      const keys = Object.keys(fileProcessed);
      for (const key in keys) {
        const bytesPassed = ethers.utils.defaultAbiCoder.encode(
          ['address', 'address', 'uint256'],
          [keys[key], angle.address, fileProcessed[keys[key]]],
        );
        const hash = web3.utils.keccak256(bytesPassed);
        elements.push(hash);
      }
      const leaf = elements[0];
      const merkleTreeLib = new MerkleTree(elements, web3.utils.keccak256, { hashLeaves: false, sortPairs: true });
      const root = merkleTreeLib.getHexRoot();
      const proof = merkleTreeLib.getHexProof(leaf);
      await angle.mint(distributor.address, parseEther('10'));
      merkleTree.merkleRoot = root;
      await distributor.connect(guardian).updateTree(merkleTree);

      await (await distributor.connect(guardian).toggleWhitelist('0x3931C80BF7a911fcda8b684b23A433D124b59F06')).wait();
      await (
        await distributor.connect(guardian).toggleOperator('0x3931C80BF7a911fcda8b684b23A433D124b59F06', bob.address)
      ).wait();
      const receipt = await (
        await distributor
          .connect(bob)
          .claim(['0x3931C80BF7a911fcda8b684b23A433D124b59F06'], [angle.address], [parseEther('1')], [proof])
      ).wait();
      inReceipt(receipt, 'Claimed', {
        user: '0x3931C80BF7a911fcda8b684b23A433D124b59F06',
        token: angle.address,
        amount: parseEther('1'),
      });
      expect(await angle.balanceOf(distributor.address)).to.be.equal(parseEther('9'));
      expect(await angle.balanceOf('0x3931C80BF7a911fcda8b684b23A433D124b59F06')).to.be.equal(parseEther('1'));
      expect(await distributor.claimed('0x3931C80BF7a911fcda8b684b23A433D124b59F06', angle.address)).to.be.equal(
        parseEther('1'),
      );
    });
    it('success - small proof on one token and token balance', async () => {
      const elements = [];
      const file = {
        '0x3931C80BF7a911fcda8b684b23A433D124b59F06': parseEther('1'),
        '0x8f02b4a44Eacd9b8eE7739aa0BA58833DD45d002': parseEther('0.5'),
      };
      const fileProcessed = file as { [name: string]: BigNumber };
      const keys = Object.keys(fileProcessed);
      for (const key in keys) {
        const bytesPassed = ethers.utils.defaultAbiCoder.encode(
          ['address', 'address', 'uint256'],
          [keys[key], angle.address, fileProcessed[keys[key]]],
        );
        const hash = web3.utils.keccak256(bytesPassed);
        elements.push(hash);
      }
      const leaf = elements[0];
      const merkleTreeLib = new MerkleTree(elements, web3.utils.keccak256, { hashLeaves: false, sortPairs: true });
      const root = merkleTreeLib.getHexRoot();
      const proof = merkleTreeLib.getHexProof(leaf);
      await angle.mint(distributor.address, parseEther('10'));
      merkleTree.merkleRoot = root;
      await distributor.connect(guardian).updateTree(merkleTree);

      const receipt = await (
        await distributor.claim(
          ['0x3931C80BF7a911fcda8b684b23A433D124b59F06'],
          [angle.address],
          [parseEther('1')],
          [proof],
        )
      ).wait();
      inReceipt(receipt, 'Claimed', {
        user: '0x3931C80BF7a911fcda8b684b23A433D124b59F06',
        token: angle.address,
        amount: parseEther('1'),
      });
      expect(await angle.balanceOf(distributor.address)).to.be.equal(parseEther('9'));
      expect(await angle.balanceOf('0x3931C80BF7a911fcda8b684b23A433D124b59F06')).to.be.equal(parseEther('1'));
      expect(await distributor.claimed('0x3931C80BF7a911fcda8b684b23A433D124b59F06', angle.address)).to.be.equal(
        parseEther('1'),
      );
    });
    it('success - small proof on one token for different addresses', async () => {
      const elements = [];
      const file = {
        '0x3931C80BF7a911fcda8b684b23A433D124b59F06': parseEther('1'),
        '0x8f02b4a44Eacd9b8eE7739aa0BA58833DD45d002': parseEther('0.5'),
      };
      const fileProcessed = file as { [name: string]: BigNumber };
      const keys = Object.keys(fileProcessed);
      for (const key in keys) {
        const bytesPassed = ethers.utils.defaultAbiCoder.encode(
          ['address', 'address', 'uint256'],
          [keys[key], angle.address, fileProcessed[keys[key]]],
        );
        const hash = web3.utils.keccak256(bytesPassed);
        elements.push(hash);
      }
      const leaf = elements[0];
      const merkleTreeLib = new MerkleTree(elements, web3.utils.keccak256, { hashLeaves: false, sortPairs: true });
      const root = merkleTreeLib.getHexRoot();
      const proof = merkleTreeLib.getHexProof(leaf);
      const proof2 = merkleTreeLib.getHexProof(elements[1]);
      await angle.mint(distributor.address, parseEther('10'));
      merkleTree.merkleRoot = root;
      await distributor.connect(guardian).updateTree(merkleTree);

      const receipt = await (
        await distributor.claim(
          ['0x3931C80BF7a911fcda8b684b23A433D124b59F06', '0x8f02b4a44Eacd9b8eE7739aa0BA58833DD45d002'],
          [angle.address, angle.address],
          [parseEther('1'), parseEther('0.5')],
          [proof, proof2],
        )
      ).wait();
      inReceipt(receipt, 'Claimed', {
        user: '0x3931C80BF7a911fcda8b684b23A433D124b59F06',
        token: angle.address,
        amount: parseEther('1'),
      });
      inReceipt(receipt, 'Claimed', {
        user: '0x8f02b4a44Eacd9b8eE7739aa0BA58833DD45d002',
        token: angle.address,
        amount: parseEther('0.5'),
      });
      expect(await angle.balanceOf(distributor.address)).to.be.equal(parseEther('8.5'));
      expect(await angle.balanceOf('0x3931C80BF7a911fcda8b684b23A433D124b59F06')).to.be.equal(parseEther('1'));
      expect(await distributor.claimed('0x3931C80BF7a911fcda8b684b23A433D124b59F06', angle.address)).to.be.equal(
        parseEther('1'),
      );
      expect(await angle.balanceOf('0x8f02b4a44Eacd9b8eE7739aa0BA58833DD45d002')).to.be.equal(parseEther('0.5'));
      expect(await distributor.claimed('0x8f02b4a44Eacd9b8eE7739aa0BA58833DD45d002', angle.address)).to.be.equal(
        parseEther('0.5'),
      );
    });

    it('success - small proof on different tokens for the same address', async () => {
      const elements = [];
      const bytesPassed1 = ethers.utils.defaultAbiCoder.encode(
        ['address', 'address', 'uint256'],
        ['0x3931C80BF7a911fcda8b684b23A433D124b59F06', angle.address, parseEther('1')],
      );
      const hash = web3.utils.keccak256(bytesPassed1);
      elements.push(hash);
      const agEUR = (await new MockToken__factory(deployer).deploy('agEUR', 'agEUR', 18)) as MockToken;
      const bytesPassed2 = ethers.utils.defaultAbiCoder.encode(
        ['address', 'address', 'uint256'],
        ['0x3931C80BF7a911fcda8b684b23A433D124b59F06', agEUR.address, parseEther('0.5')],
      );
      elements.push(web3.utils.keccak256(bytesPassed2));

      const leaf = elements[0];
      const merkleTreeLib = new MerkleTree(elements, web3.utils.keccak256, { hashLeaves: false, sortPairs: true });
      const root = merkleTreeLib.getHexRoot();
      const proof = merkleTreeLib.getHexProof(leaf);
      const proof2 = merkleTreeLib.getHexProof(elements[1]);
      await angle.mint(distributor.address, parseEther('10'));
      await agEUR.mint(distributor.address, parseEther('0.5'));
      merkleTree.merkleRoot = root;
      await distributor.connect(guardian).updateTree(merkleTree);

      const receipt = await (
        await distributor.claim(
          ['0x3931C80BF7a911fcda8b684b23A433D124b59F06', '0x3931C80BF7a911fcda8b684b23A433D124b59F06'],
          [angle.address, agEUR.address],
          [parseEther('1'), parseEther('0.5')],
          [proof, proof2],
        )
      ).wait();
      inReceipt(receipt, 'Claimed', {
        user: '0x3931C80BF7a911fcda8b684b23A433D124b59F06',
        token: angle.address,
        amount: parseEther('1'),
      });
      inReceipt(receipt, 'Claimed', {
        user: '0x3931C80BF7a911fcda8b684b23A433D124b59F06',
        token: agEUR.address,
        amount: parseEther('0.5'),
      });
      expect(await angle.balanceOf(distributor.address)).to.be.equal(parseEther('9'));
      expect(await angle.balanceOf('0x3931C80BF7a911fcda8b684b23A433D124b59F06')).to.be.equal(parseEther('1'));
      expect(await distributor.claimed('0x3931C80BF7a911fcda8b684b23A433D124b59F06', angle.address)).to.be.equal(
        parseEther('1'),
      );
      expect(await agEUR.balanceOf(distributor.address)).to.be.equal(parseEther('0'));
      expect(await agEUR.balanceOf('0x3931C80BF7a911fcda8b684b23A433D124b59F06')).to.be.equal(parseEther('0.5'));
      expect(await distributor.claimed('0x3931C80BF7a911fcda8b684b23A433D124b59F06', agEUR.address)).to.be.equal(
        parseEther('0.5'),
      );
    });
    it('success - two claims on the same token by the same address', async () => {
      let elements = [];
      const bytesPassed1 = ethers.utils.defaultAbiCoder.encode(
        ['address', 'address', 'uint256'],
        ['0x3931C80BF7a911fcda8b684b23A433D124b59F06', angle.address, parseEther('1')],
      );
      elements.push(web3.utils.keccak256(bytesPassed1));
      const agEUR = (await new MockToken__factory(deployer).deploy('agEUR', 'agEUR', 18)) as MockToken;
      const bytesPassed2 = ethers.utils.defaultAbiCoder.encode(
        ['address', 'address', 'uint256'],
        ['0x3931C80BF7a911fcda8b684b23A433D124b59F06', agEUR.address, parseEther('0.5')],
      );
      elements.push(web3.utils.keccak256(bytesPassed2));

      const leaf = elements[0];
      const merkleTreeLib = new MerkleTree(elements, web3.utils.keccak256, { hashLeaves: false, sortPairs: true });
      const root = merkleTreeLib.getHexRoot();
      const proof = merkleTreeLib.getHexProof(leaf);
      await angle.mint(distributor.address, parseEther('10'));
      await agEUR.mint(distributor.address, parseEther('0.5'));
      merkleTree.merkleRoot = root;
      await distributor.connect(guardian).updateTree(merkleTree);

      // Doing first claim
      const receipt = await (
        await distributor.claim(
          ['0x3931C80BF7a911fcda8b684b23A433D124b59F06'],
          [angle.address],
          [parseEther('1')],
          [proof],
        )
      ).wait();
      inReceipt(receipt, 'Claimed', {
        user: '0x3931C80BF7a911fcda8b684b23A433D124b59F06',
        token: angle.address,
        amount: parseEther('1'),
      });

      expect(await angle.balanceOf(distributor.address)).to.be.equal(parseEther('9'));
      expect(await angle.balanceOf('0x3931C80BF7a911fcda8b684b23A433D124b59F06')).to.be.equal(parseEther('1'));
      expect(await distributor.claimed('0x3931C80BF7a911fcda8b684b23A433D124b59F06', angle.address)).to.be.equal(
        parseEther('1'),
      );
      // Updating Merkle root after second claim
      elements = [];
      // Now the person can claim 2 additional tokens
      const bytesPassed3 = ethers.utils.defaultAbiCoder.encode(
        ['address', 'address', 'uint256'],
        ['0x3931C80BF7a911fcda8b684b23A433D124b59F06', angle.address, parseEther('3')],
      );
      elements.push(web3.utils.keccak256(bytesPassed3));
      const bytesPassed4 = ethers.utils.defaultAbiCoder.encode(
        ['address', 'address', 'uint256'],
        ['0x3931C80BF7a911fcda8b684b23A433D124b59F06', agEUR.address, parseEther('0.5')],
      );
      elements.push(web3.utils.keccak256(bytesPassed4));
      const merkleTreeLib2 = new MerkleTree(elements, web3.utils.keccak256, { hashLeaves: false, sortPairs: true });
      const root2 = merkleTreeLib2.getHexRoot();
      const proof2 = merkleTreeLib2.getHexProof(elements[0]);
      merkleTree.merkleRoot = root2;
      await distributor.connect(guardian).updateTree(merkleTree);
      const receipt2 = await (
        await distributor.claim(
          ['0x3931C80BF7a911fcda8b684b23A433D124b59F06'],
          [angle.address],
          [parseEther('3')],
          [proof2],
        )
      ).wait();
      inReceipt(receipt2, 'Claimed', {
        user: '0x3931C80BF7a911fcda8b684b23A433D124b59F06',
        token: angle.address,
        amount: parseEther('2'),
      });

      expect(await angle.balanceOf(distributor.address)).to.be.equal(parseEther('7'));
      expect(await angle.balanceOf('0x3931C80BF7a911fcda8b684b23A433D124b59F06')).to.be.equal(parseEther('3'));
      expect(await distributor.claimed('0x3931C80BF7a911fcda8b684b23A433D124b59F06', angle.address)).to.be.equal(
        parseEther('3'),
      );
    });
  });
});
