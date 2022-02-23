import { ActionType, CONTRACTS_ADDRESSES } from '@angleprotocol/sdk';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { Signer } from 'ethers';
import { parseEther, parseUnits } from 'ethers/lib/utils';
import hre, { contract, ethers } from 'hardhat';

import {
  AgToken,
  AgToken__factory,
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
import {
  addCollateral,
  angle,
  borrow,
  closeVault,
  createVault,
  deployUpgradeable,
  ZERO_ADDRESS,
} from '../utils/helpers';

contract('VaultManager', () => {
  let deployer: SignerWithAddress;
  let governor: SignerWithAddress;
  let guardian: SignerWithAddress;
  let proxyAdmin: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let charlie: SignerWithAddress;

  let treasury: MockTreasury;
  let collateral: MockToken;
  let oracle: MockOracle;
  let stableMaster: MockStableMaster;
  let agToken: AgToken;
  let vaultManager: VaultManager;

  const impersonatedSigners: { [key: string]: Signer } = {};

  const collatBase = 10;
  const params = {
    dust: 100,
    dustCollateral: 100,
    debtCeiling: parseEther('100'),
    collateralFactor: parseUnits('0.5', 'gwei'),
    targetHealthFactor: parseUnits('1.1', 'gwei'),
    borrowFee: parseUnits('0.1', 'gwei'),
    interestRate: 100,
    liquidationSurcharge: parseUnits('0.9', 'gwei'),
    maxLiquidationDiscount: parseUnits('0.1', 'gwei'),
    liquidationBooster: parseUnits('0.1', 'gwei'),
    whitelistingActivated: false,
  };

  before(async () => {
    ({ deployer, alice, bob, charlie, governor, guardian, proxyAdmin } = await ethers.getNamedSigners());
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

    collateral = await new MockToken__factory(deployer).deploy('USDC', 'USDC', collatBase);

    vaultManager = (await deployUpgradeable(new VaultManager__factory(deployer))) as VaultManager;

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

    oracle = await new MockOracle__factory(deployer).deploy(2 * 10 ** collatBase, collatBase, treasury.address);
  });

  describe('initializer', () => {
    it('revert - oracle treasury differs', async () => {
      oracle = await new MockOracle__factory(deployer).deploy(2 * 10 ** collatBase, collatBase, ZERO_ADDRESS);
      const tx = vaultManager.initialize(treasury.address, collateral.address, oracle.address, params);
      await expect(tx).to.be.revertedWith('33');
    });

    it('success - setters', async () => {
      await vaultManager.initialize(treasury.address, collateral.address, oracle.address, params);
      expect(await vaultManager.oracle()).to.be.equal(oracle.address);
      expect(await vaultManager.treasury()).to.be.equal(treasury.address);
      expect(await vaultManager.collateral()).to.be.equal(collateral.address);
      expect(await vaultManager.collatBase()).to.be.equal(10 ** collatBase);
      expect(await vaultManager.stablecoin()).to.be.equal(agToken.address);
      expect(await vaultManager.stablecoin()).to.be.equal(agToken.address);
      expect(await vaultManager.name()).to.be.equal('Angle Protocol USDC/agEUR Vault');
      expect(await vaultManager.symbol()).to.be.equal('USDC/agEUR-vault');
      expect(await vaultManager.paused()).to.be.true;
    });

    it('success - access control', async () => {
      await vaultManager.initialize(treasury.address, collateral.address, oracle.address, params);
      await expect(vaultManager.connect(alice).unpause()).to.be.reverted;
      await expect(vaultManager.connect(deployer).unpause()).to.be.reverted;
      await expect(vaultManager.connect(proxyAdmin).unpause()).to.be.reverted;
      await vaultManager.connect(guardian).unpause();
      expect(await vaultManager.paused()).to.be.false;

      await expect(vaultManager.connect(deployer).toggleWhitelisting()).to.be.reverted;
      await expect(vaultManager.connect(guardian).toggleWhitelisting()).to.be.reverted;
      await vaultManager.connect(governor).toggleWhitelisting();
      expect(await vaultManager.whitelistingActivated()).to.be.true;
    });

    it('revert - already initialized', async () => {
      await vaultManager.initialize(treasury.address, collateral.address, oracle.address, params);
      const tx = vaultManager.initialize(treasury.address, collateral.address, oracle.address, params);
      await expect(tx).to.be.reverted;
    });

    it('revert - collateral factor > liquidation surcharge', async () => {
      const auxPar = { ...params };
      auxPar.collateralFactor = parseUnits('0.95', 'gwei');
      const tx = vaultManager.initialize(treasury.address, collateral.address, oracle.address, auxPar);
      await expect(tx).to.be.revertedWith('15');
    });

    it('revert - targetHealthFactor < 1', async () => {
      const auxPar = { ...params };
      auxPar.targetHealthFactor = parseUnits('0.9999', 'gwei');
      const tx = vaultManager.initialize(treasury.address, collateral.address, oracle.address, auxPar);
      await expect(tx).to.be.revertedWith('15');
    });

    it('revert - liquidationSurcharge > 1', async () => {
      const auxPar = { ...params };
      auxPar.liquidationSurcharge = parseUnits('1.0001', 'gwei');
      const tx = vaultManager.initialize(treasury.address, collateral.address, oracle.address, auxPar);
      await expect(tx).to.be.revertedWith('15');
    });

    it('revert - borrowFee > 1', async () => {
      const auxPar = { ...params };
      auxPar.borrowFee = parseUnits('1.0001', 'gwei');
      const tx = vaultManager.initialize(treasury.address, collateral.address, oracle.address, auxPar);
      await expect(tx).to.be.revertedWith('15');
    });

    it('revert - maxLiquidationDiscount > 1', async () => {
      const auxPar = { ...params };
      auxPar.maxLiquidationDiscount = parseUnits('1.0001', 'gwei');
      const tx = vaultManager.initialize(treasury.address, collateral.address, oracle.address, auxPar);
      await expect(tx).to.be.revertedWith('15');
    });
  });

  describe('ERC721', () => {
    beforeEach(async () => {
      await vaultManager.initialize(treasury.address, collateral.address, oracle.address, params);
      await vaultManager.connect(guardian).unpause();
    });
    describe('getControlledVaults', () => {
      it('success - no vault', async () => {
        const [, count] = await vaultManager.getControlledVaults(alice.address);
        expect(count).to.be.equal(0);
      });

      it('success -,first vault', async () => {
        await angle(vaultManager, alice, [createVault(alice.address)]);
        const [vaults] = await vaultManager.getControlledVaults(alice.address);
        expect(vaults.length).to.be.equal(1);
        expect(vaults[0].toNumber()).to.be.equal(1);
      });

      it('success - second vault', async () => {
        await angle(vaultManager, bob, [createVault(bob.address)]);
        await angle(vaultManager, alice, [createVault(alice.address)]);
        const [vaults, count] = await vaultManager.getControlledVaults(alice.address);
        expect(vaults.length).to.be.equal(2);
        expect(count).to.be.equal(1);
        expect(vaults[0].toNumber()).to.be.equal(2);
      });

      it('success - second and third vault', async () => {
        await angle(vaultManager, bob, [createVault(bob.address)]);
        await angle(vaultManager, alice, [createVault(alice.address)]);
        await angle(vaultManager, alice, [createVault(alice.address)]);
        const [vaults, count] = await vaultManager.getControlledVaults(alice.address);
        expect(vaults.length).to.be.equal(3);
        expect(count).to.be.equal(2);
        expect(vaults[0].toNumber()).to.be.equal(2);
        expect(vaults[1].toNumber()).to.be.equal(3);
      });

      it('success - burn vault', async () => {
        await angle(vaultManager, bob, [createVault(bob.address)]);
        await angle(vaultManager, alice, [createVault(alice.address)]);
        await angle(vaultManager, alice, [createVault(alice.address)]);
        await angle(vaultManager, alice, [closeVault(2)]);
        const [vaults, count] = await vaultManager.getControlledVaults(alice.address);
        expect(vaults.length).to.be.equal(3);
        expect(count).to.be.equal(1);
        expect(vaults[0].toNumber()).to.be.equal(3);
      });
    });

    describe('isApprovedOrOwner', () => {
      beforeEach(async () => {
        await angle(vaultManager, alice, [createVault(alice.address)]);
        await collateral.connect(alice).mint(alice.address, parseEther('1'));
        await collateral.connect(alice).approve(vaultManager.address, parseEther('1'));
        await angle(vaultManager, alice, [addCollateral(1, parseEther('1')), borrow(1, 1)]);
      });

      it('success - owner is approved', async () => {
        expect(await vaultManager.isApprovedOrOwner(alice.address, 1)).to.be.true;
      });

      it('success - non owner', async () => {
        expect(await vaultManager.isApprovedOrOwner(bob.address, 1)).to.be.false;
      });

      it('success - approved', async () => {
        await vaultManager.connect(alice).approve(bob.address, 1);
        expect(await vaultManager.isApprovedOrOwner(alice.address, 1)).to.be.true;
      });
    });

    describe('tokenURI', () => {
      beforeEach(async () => {
        await vaultManager.connect(guardian).setBaseURI('website');
        await angle(vaultManager, alice, [createVault(alice.address)]);
        for (let i = 0; i < 20; i++) await angle(vaultManager, alice, [createVault(alice.address)]);
        await angle(vaultManager, alice, [createVault(alice.address)]);
        await angle(vaultManager, alice, [closeVault(1)]);
      });

      it('revert - Unexistent vault', async () => {
        await expect(vaultManager.tokenURI(1)).to.be.revertedWith('26');
      });

      it('success - 1 decimal vault', async () => {
        expect(await vaultManager.tokenURI(2)).to.be.equal('website2');
      });

      it('revert - 2 decimal vault', async () => {
        expect(await vaultManager.tokenURI(11)).to.be.equal('website11');
      });
    });

    describe('balanceOf', () => {
      beforeEach(async () => {
        await vaultManager.connect(guardian).setBaseURI('website');
        for (let i = 0; i < 20; i++) await angle(vaultManager, alice, [createVault(alice.address)]);
        await angle(vaultManager, alice, [closeVault(1)]);
      });

      it('revert - zero address', async () => {
        await expect(vaultManager.balanceOf(ZERO_ADDRESS)).to.be.revertedWith('0');
      });

      it('success', async () => {
        expect(await vaultManager.balanceOf(alice.address)).to.be.equal(19);
      });
    });

    describe('ownerOf', () => {
      beforeEach(async () => {
        await vaultManager.connect(guardian).setBaseURI('website');
        for (let i = 0; i < 2; i++) await angle(vaultManager, alice, [createVault(alice.address)]);
        await angle(vaultManager, alice, [closeVault(1)]);
      });

      it('revert - closed vault', async () => {
        await expect(vaultManager.ownerOf(1)).to.be.revertedWith('26');
      });

      it('revert - unexistant vault', async () => {
        await expect(vaultManager.ownerOf(100)).to.be.revertedWith('26');
      });

      it('success', async () => {
        expect(await vaultManager.ownerOf(2)).to.be.equal(alice.address);
      });
    });

    describe('approve', () => {
      beforeEach(async () => {
        await vaultManager.connect(guardian).setBaseURI('website');
        for (let i = 0; i < 2; i++) await angle(vaultManager, alice, [createVault(alice.address)]);
        await angle(vaultManager, alice, [closeVault(1)]);
      });

      it('revert - cannot self approve', async () => {
        await expect(vaultManager.connect(alice).approve(alice.address, 2)).to.be.revertedWith('27');
      });

      it('revert - unexistant vault', async () => {
        await expect(vaultManager.connect(alice).approve(bob.address, 1)).to.be.revertedWith('26');
      });

      it('success', async () => {
        await vaultManager.connect(alice).approve(bob.address, 2);
        expect(await vaultManager.isApprovedOrOwner(bob.address, 2)).to.be.true;
      });
    });

    describe('getApproved', () => {
      beforeEach(async () => {
        await vaultManager.connect(guardian).setBaseURI('website');
        for (let i = 0; i < 2; i++) await angle(vaultManager, alice, [createVault(alice.address)]);
        await angle(vaultManager, alice, [closeVault(1)]);
      });

      it('revert - unexistant vault', async () => {
        await expect(vaultManager.connect(alice).getApproved(1)).to.be.revertedWith('26');
      });

      it('success', async () => {
        await vaultManager.connect(alice).approve(bob.address, 2);
        expect(await vaultManager.getApproved(2)).to.be.equal(bob.address);
      });
    });

    describe('setApprovalForAll', () => {
      beforeEach(async () => {
        await vaultManager.connect(guardian).setBaseURI('website');
        for (let i = 0; i < 4; i++) await angle(vaultManager, alice, [createVault(alice.address)]);
        await angle(vaultManager, alice, [closeVault(1)]);
      });

      it('revert - cannot self approve', async () => {
        await expect(vaultManager.connect(alice).setApprovalForAll(alice.address, true)).to.be.revertedWith('28');
      });

      it('success', async () => {
        await vaultManager.connect(alice).setApprovalForAll(bob.address, true);
        expect(await vaultManager.isApprovedOrOwner(bob.address, 2)).to.be.true;
        expect(await vaultManager.isApprovedOrOwner(bob.address, 3)).to.be.true;

        await vaultManager.connect(alice).setApprovalForAll(bob.address, false);
        expect(await vaultManager.isApprovedOrOwner(bob.address, 2)).to.be.false;
        expect(await vaultManager.isApprovedOrOwner(bob.address, 3)).to.be.false;
      });
    });

    describe('isApprovedForAll', () => {
      beforeEach(async () => {
        await vaultManager.connect(guardian).setBaseURI('website');
        for (let i = 0; i < 4; i++) await angle(vaultManager, alice, [createVault(alice.address)]);
        await angle(vaultManager, alice, [closeVault(1)]);
      });

      it('success', async () => {
        expect(await vaultManager.isApprovedForAll(alice.address, bob.address)).to.be.false;
        await vaultManager.connect(alice).setApprovalForAll(bob.address, true);
        expect(await vaultManager.isApprovedForAll(alice.address, bob.address)).to.be.true;
        await vaultManager.connect(alice).setApprovalForAll(bob.address, false);
        expect(await vaultManager.isApprovedForAll(alice.address, bob.address)).to.be.false;
      });
    });

    describe('transferFrom', () => {
      beforeEach(async () => {
        await vaultManager.connect(guardian).setBaseURI('website');
        for (let i = 0; i < 4; i++) await angle(vaultManager, alice, [createVault(alice.address)]);
        await angle(vaultManager, alice, [closeVault(1)]);
      });

      it('revert - neither approved or owner', async () => {
        await expect(vaultManager.connect(charlie).transferFrom(alice.address, bob.address, 2)).to.be.reverted;
      });

      it('success', async () => {
        await vaultManager.connect(alice).transferFrom(alice.address, bob.address, 2);
        expect(await vaultManager.ownerOf(2)).to.be.equal(bob.address);
      });

      it('success - with approval', async () => {
        await vaultManager.connect(alice).approve(charlie.address, 2);
        await vaultManager.connect(charlie).transferFrom(alice.address, bob.address, 2);
        expect(await vaultManager.ownerOf(2)).to.be.equal(bob.address);
      });
    });

    describe('safeTransferFrom', () => {
      beforeEach(async () => {
        await vaultManager.connect(guardian).setBaseURI('website');
        for (let i = 0; i < 4; i++) await angle(vaultManager, alice, [createVault(alice.address)]);
        await angle(vaultManager, alice, [closeVault(1)]);
      });

      it('revert - neither approved or owner', async () => {
        await expect(
          vaultManager.connect(charlie)['safeTransferFrom(address,address,uint256)'](alice.address, bob.address, 2),
        ).to.be.reverted;
      });

      it('revert - checkOnERC721 received', async () => {
        await expect(
          vaultManager
            .connect(alice)
            ['safeTransferFrom(address,address,uint256)'](alice.address, vaultManager.address, 2),
        ).to.be.reverted;
      });

      it('success', async () => {
        await vaultManager.connect(alice)['safeTransferFrom(address,address,uint256)'](alice.address, bob.address, 2);
        expect(await vaultManager.ownerOf(2)).to.be.equal(bob.address);
      });

      it('success - with approval', async () => {
        await vaultManager.connect(alice).approve(charlie.address, 2);
        await vaultManager
          .connect(charlie)
          ['safeTransferFrom(address,address,uint256,bytes)'](alice.address, bob.address, 2, '0x');
        expect(await vaultManager.ownerOf(2)).to.be.equal(bob.address);
      });
    });

    describe('supportsInterface', () => {
      it('success - IERC721', async () => {
        expect(await vaultManager.supportsInterface('0x55555555')).to.be.false;
      });
    });
  });
});
