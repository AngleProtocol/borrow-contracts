import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { Signer, utils } from 'ethers';
import { parseEther } from 'ethers/lib/utils';
import hre, { contract, ethers, web3 } from 'hardhat';

// import { fromRpcSig } from 'ethereumjs-util';
import { expect } from '../../test/hardhat/utils/chai-setup';
import { inIndirectReceipt, inReceipt } from '../../test/hardhat/utils/expectEvent';
import { deployUpgradeable, mine, time, ZERO_ADDRESS } from '../../test/hardhat/utils/helpers';
import {
  CoreBorrow,
  CoreBorrow__factory,
  FlashAngle,
  FlashAngle__factory,
  MockToken,
  MockToken__factory,
  ProxyAdmin,
  ProxyAdmin__factory,
  TokenPolygonUpgradeable,
  TokenPolygonUpgradeable__factory,
  Treasury,
  Treasury__factory,
} from '../../typechain';
import { parseAmount } from '../../utils/bignumber';
// import { domainSeparator, signPermit } from '../../test/utils/sigUtils';

contract('TokenPolygonUpgradeable - End-to-end Upgrade', () => {
  let deployer: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let charlie: SignerWithAddress;

  let flashAngle: FlashAngle;
  let coreBorrow: CoreBorrow;
  let bridgeToken: MockToken;
  let bridgeToken2: MockToken;
  let agToken: TokenPolygonUpgradeable;
  let treasury: Treasury;
  let polygonGovernor: string;
  let guardian: string;
  let governor: string;
  let proxyAdmin: ProxyAdmin;
  let depositorRole: string;
  let governorRole: string;
  let guardianRole: string;
  let flashloanerTreasuryRole: string;
  let defaultAdminRole: string;

  const impersonatedSigners: { [key: string]: Signer } = {};

  before(async () => {
    [deployer, alice, bob, charlie] = await ethers.getSigners();
    // Multisig address on Polygon
    governor = '0xdA2D2f638D6fcbE306236583845e5822554c02EA';
    polygonGovernor = '0xA6FA4fB5f76172d178d61B04b0ecd319C5d1C0aa';
    guardian = '0xfdA462548Ce04282f4B6D6619823a7C64Fdc0185';
    const impersonatedAddresses = [polygonGovernor, governor, guardian];

    for (const address of impersonatedAddresses) {
      await hre.network.provider.request({
        method: 'hardhat_impersonateAccount',
        params: [address],
      });
      await hre.network.provider.send('hardhat_setBalance', [address, '0x10000000000000000000000000000']);
      impersonatedSigners[address] = await ethers.getSigner(address);
      depositorRole = web3.utils.keccak256('DEPOSITOR_ROLE');
      guardianRole = web3.utils.keccak256('GUARDIAN_ROLE');
      governorRole = web3.utils.keccak256('GOVERNOR_ROLE');
      defaultAdminRole = '0x0000000000000000000000000000000000000000000000000000000000000000';
      flashloanerTreasuryRole = web3.utils.keccak256('FLASHLOANER_TREASURY_ROLE');
    }
  });

  before(async () => {
    proxyAdmin = new ethers.Contract(
      '0xbfca293e17e067e8abdca30a5d35addd0cbae6d6',
      ProxyAdmin__factory.createInterface(),
      deployer,
    ) as ProxyAdmin;

    const implementation = await new TokenPolygonUpgradeable__factory(deployer).deploy();
    // agEUR on Polygon
    const agTokenAddress = '0xE0B52e49357Fd4DAf2c15e02058DCE6BC0057db4';

    await (
      await proxyAdmin.connect(impersonatedSigners[governor]).upgrade(agTokenAddress, implementation.address)
    ).wait();

    agToken = new ethers.Contract(
      agTokenAddress,
      TokenPolygonUpgradeable__factory.createInterface(),
      deployer,
    ) as TokenPolygonUpgradeable;

    coreBorrow = (await deployUpgradeable(new CoreBorrow__factory(deployer))) as CoreBorrow;
    await coreBorrow.initialize(governor, guardian);
    flashAngle = (await deployUpgradeable(new FlashAngle__factory(deployer))) as FlashAngle;
    await flashAngle.initialize(coreBorrow.address);
    await coreBorrow.connect(impersonatedSigners[governor]).setFlashLoanModule(flashAngle.address);

    treasury = (await deployUpgradeable(new Treasury__factory(deployer))) as Treasury;
    await treasury.initialize(coreBorrow.address, agToken.address);

    await agToken.connect(impersonatedSigners[governor]).setUpTreasury(treasury.address);
    await coreBorrow.connect(impersonatedSigners[governor]).addFlashLoanerTreasuryRole(treasury.address);
    bridgeToken = (await new MockToken__factory(deployer).deploy('any-agEUR', 'any-agEUR', 18)) as MockToken;
    bridgeToken2 = (await new MockToken__factory(deployer).deploy('synapse-agEUR', 'synapse-agEUR', 18)) as MockToken;
    // adding bridge token
    await agToken
      .connect(impersonatedSigners[governor])
      .addBridgeToken(bridgeToken.address, parseEther('10'), parseEther('1'), parseAmount.gwei(0.5), false);
  });

  describe('upgrade - old References & Variables', () => {
    it('success - old references', async () => {
      expect(await agToken.name()).to.be.equal('agEUR');
      expect(await agToken.symbol()).to.be.equal('agEUR');
      expect(await agToken.DEPOSITOR_ROLE()).to.be.equal(depositorRole);
    });
    it('success - contracts already initialized', async () => {
      await expect(coreBorrow.initialize(governor, guardian)).to.be.revertedWith(
        'Initializable: contract is already initialized',
      );
      await expect(treasury.initialize(governor, guardian)).to.be.revertedWith(
        'Initializable: contract is already initialized',
      );
      await expect(agToken.initialize('agEUR', 'agEUR', governor, governor)).to.be.revertedWith(
        'Initializable: contract is already initialized',
      );
      await expect(flashAngle.initialize(governor)).to.be.revertedWith(
        'Initializable: contract is already initialized',
      );
    });
  });
  describe('upgrade - New References & Variables', () => {
    it('success - coreBorrow', async () => {
      expect(await coreBorrow.flashLoanModule()).to.be.equal(flashAngle.address);
      expect(await coreBorrow.isGovernor(governor)).to.be.equal(true);
      expect(await coreBorrow.isGovernor(guardian)).to.be.equal(false);
      expect(await coreBorrow.isGovernorOrGuardian(guardian)).to.be.equal(true);
      expect(await coreBorrow.isGovernorOrGuardian(governor)).to.be.equal(true);
      expect(await coreBorrow.isFlashLoanerTreasury(treasury.address)).to.be.equal(true);
      expect(await coreBorrow.isFlashLoanerTreasury(guardian)).to.be.equal(false);
      expect(await coreBorrow.getRoleAdmin(guardianRole)).to.be.equal(governorRole);
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
      expect(await agToken.treasury()).to.be.equal(treasury.address);
      expect(await agToken.treasuryInitialized()).to.be.equal(true);
      expect(await agToken.hasRole(depositorRole, polygonGovernor)).to.be.equal(true);
      expect(await agToken.hasRole(defaultAdminRole, governor)).to.be.equal(true);
    });
    it('success - flashAngle', async () => {
      expect(await flashAngle.core()).to.be.equal(coreBorrow.address);
      expect((await flashAngle.stablecoinMap(agToken.address)).treasury).to.be.equal(treasury.address);
    });
  });

  describe('deposit', () => {
    it('reverts - invalid caller', async () => {
      const bytesPassed = ethers.utils.defaultAbiCoder.encode(['uint256'], [parseEther('1')]);
      await expect(agToken.connect(alice).deposit(alice.address, bytesPassed)).to.be.reverted;
    });
    it('success - when called by bridge', async () => {
      const bytesPassed = ethers.utils.defaultAbiCoder.encode(['uint256'], [parseEther('50')]);
      const aliceBalance = await agToken.balanceOf(alice.address);
      const receipt = await (
        await agToken.connect(impersonatedSigners[polygonGovernor]).deposit(alice.address, bytesPassed)
      ).wait();
      inReceipt(receipt, 'Transfer', {
        from: ZERO_ADDRESS,
        to: alice.address,
        value: parseEther('50'),
      });
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('50').add(aliceBalance));
    });
    it('success - from role granted 1/2', async () => {
      const bytesPassed = ethers.utils.defaultAbiCoder.encode(['uint256'], [parseEther('47')]);
      await agToken.connect(impersonatedSigners[governor]).grantRole(depositorRole, governor);
      const aliceBalance = await agToken.balanceOf(alice.address);
      const receipt = await (
        await agToken.connect(impersonatedSigners[governor]).deposit(alice.address, bytesPassed)
      ).wait();
      inReceipt(receipt, 'Transfer', {
        from: ZERO_ADDRESS,
        to: alice.address,
        value: parseEther('47'),
      });
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('47').add(aliceBalance));
      // Reset state and revoke role
      await agToken.connect(impersonatedSigners[governor]).renounceRole(depositorRole, governor);
      expect(await agToken.hasRole(depositorRole, governor)).to.be.equal(false);
    });
    it('success - from role granted 2/2', async () => {
      const bytesPassed = ethers.utils.defaultAbiCoder.encode(['uint256'], [parseEther('1000000')]);
      console.log(bytesPassed);
      await agToken.connect(impersonatedSigners[governor]).grantRole(depositorRole, governor);
      const aliceBalance = await agToken.balanceOf(alice.address);
      const receipt = await (
        await agToken.connect(impersonatedSigners[governor]).deposit(alice.address, bytesPassed)
      ).wait();
      inReceipt(receipt, 'Transfer', {
        from: ZERO_ADDRESS,
        to: alice.address,
        value: parseEther('1000000'),
      });
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('1000000').add(aliceBalance));
      // Reset state and revoke role
      await agToken.connect(impersonatedSigners[governor]).renounceRole(depositorRole, governor);
      expect(await agToken.hasRole(depositorRole, governor)).to.be.equal(false);
    });
  });
  describe('withdraw', () => {
    it('reverts - invalid balance', async () => {
      const aliceBalance = await agToken.balanceOf(alice.address);
      await expect(agToken.connect(alice).withdraw(aliceBalance.add(1))).to.be.reverted;
    });
    it('success - balance burned', async () => {
      const aliceBalance = await agToken.balanceOf(alice.address);
      const receipt = await (await agToken.connect(alice).withdraw(aliceBalance)).wait();
      inReceipt(receipt, 'Transfer', {
        from: alice.address,
        to: ZERO_ADDRESS,
        value: aliceBalance,
      });
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('0'));
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
      await expect(treasury.connect(impersonatedSigners[governor]).addMinter(ZERO_ADDRESS)).to.be.revertedWith(
        'ZeroAddress',
      );
    });
    it('reverts - non treasury', async () => {
      await expect(agToken.addMinter(alice.address)).to.be.revertedWith('NotTreasury');
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
        to: agToken.address,
        value: parseEther('500'),
      });
      expect(await agToken.balanceOf(alice.address)).to.be.equal(parseEther('500'));
    });
    it('reverts - when non minter', async () => {
      await expect(agToken.connect(bob).burnSelf(parseEther('500'), alice.address)).to.be.revertedWith('NotMinter');
    });
  });
  describe('burnFrom', () => {
    it('reverts - when non minter', async () => {
      await expect(agToken.connect(bob).burnFrom(parseEther('500'), alice.address, bob.address)).to.be.revertedWith(
        'NotMinter',
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
        'BurnAmountExceedsAllowance',
      );
    });
    it('success - when allowance', async () => {
      await agToken.connect(alice).approve(bob.address, parseEther('1000'));
      expect(await agToken.allowance(alice.address, bob.address)).to.be.equal(parseEther('1000'));
      const receipt = await (await agToken.connect(bob).burnFrom(parseEther('100'), alice.address, bob.address)).wait();
      inReceipt(receipt, 'Transfer', {
        from: alice.address,
        to: agToken.address,
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
        to: agToken.address,
        value: parseEther('100'),
      });
    });
  });

  describe('removeMinter', () => {
    it('reverts - non minter', async () => {
      await expect(agToken.connect(charlie).removeMinter(alice.address)).to.be.revertedWith('InvalidSender');
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

  describe('addBridgeToken', () => {
    it('success - token added', async () => {
      expect((await agToken.bridges(bridgeToken.address)).paused).to.be.equal(false);
      expect((await agToken.bridges(bridgeToken.address)).limit).to.be.equal(parseEther('10'));
      expect((await agToken.bridges(bridgeToken.address)).hourlyLimit).to.be.equal(parseEther('1'));
      expect((await agToken.bridges(bridgeToken.address)).allowed).to.be.equal(true);
      expect((await agToken.bridges(bridgeToken.address)).fee).to.be.equal(parseAmount.gwei(0.5));
      expect(await agToken.bridgeTokensList(0)).to.be.equal(bridgeToken.address);
      expect((await agToken.allBridgeTokens())[0]).to.be.equal(bridgeToken.address);
    });
    it('reverts - non governor', async () => {
      await expect(
        agToken
          .connect(bob)
          .addBridgeToken(bridgeToken.address, parseEther('1'), parseEther('0.1'), parseAmount.gwei(0.5), false),
      ).to.be.revertedWith('NotGovernor');
    });
    it('reverts - too high parameter value', async () => {
      await expect(
        agToken
          .connect(impersonatedSigners[governor])
          .addBridgeToken(bridgeToken2.address, parseEther('1'), parseEther('0.1'), parseAmount.gwei(2), false),
      ).to.be.revertedWith('TooHighParameterValue');
    });
    it('reverts - zero address', async () => {
      await expect(
        agToken
          .connect(impersonatedSigners[governor])
          .addBridgeToken(ZERO_ADDRESS, parseEther('1'), parseEther('0.1'), parseAmount.gwei(0.5), false),
      ).to.be.revertedWith('InvalidToken');
    });
    it('reverts - already added', async () => {
      await expect(
        agToken
          .connect(impersonatedSigners[governor])
          .addBridgeToken(bridgeToken.address, parseEther('1'), parseEther('0.1'), parseAmount.gwei(0.5), false),
      ).to.be.revertedWith('InvalidToken');
    });
    it('success - second token added', async () => {
      const receipt = await (
        await agToken
          .connect(impersonatedSigners[governor])
          .addBridgeToken(bridgeToken2.address, parseEther('100'), parseEther('10'), parseAmount.gwei(0.03), true)
      ).wait();
      inReceipt(receipt, 'BridgeTokenAdded', {
        bridgeToken: bridgeToken2.address,
        limit: parseEther('100'),
        fee: parseAmount.gwei(0.03),
        paused: true,
      });
      expect((await agToken.bridges(bridgeToken2.address)).paused).to.be.equal(true);
      expect((await agToken.bridges(bridgeToken2.address)).limit).to.be.equal(parseEther('100'));
      expect((await agToken.bridges(bridgeToken2.address)).hourlyLimit).to.be.equal(parseEther('10'));
      expect((await agToken.bridges(bridgeToken2.address)).allowed).to.be.equal(true);
      expect((await agToken.bridges(bridgeToken2.address)).fee).to.be.equal(parseAmount.gwei(0.03));
      expect(await agToken.bridgeTokensList(1)).to.be.equal(bridgeToken2.address);
      expect((await agToken.allBridgeTokens())[1]).to.be.equal(bridgeToken2.address);
      // Removing it to reset state
      await agToken.connect(impersonatedSigners[governor]).removeBridgeToken(bridgeToken2.address);
    });
  });
  describe('removeBridgeToken', () => {
    it('reverts - non governor', async () => {
      await expect(agToken.connect(bob).removeBridgeToken(bridgeToken.address)).to.be.revertedWith('NotGovernor');
    });
    it('reverts - non null balance', async () => {
      await bridgeToken.mint(agToken.address, parseEther('1'));
      await expect(
        agToken.connect(impersonatedSigners[governor]).removeBridgeToken(bridgeToken.address),
      ).to.be.revertedWith('AssetStillControlledInReserves');
      await bridgeToken.burn(agToken.address, parseEther('1'));
    });
    it('success - mappings updated when there is one token', async () => {
      const balance = await bridgeToken.balanceOf(agToken.address);
      const receipt = await (
        await agToken.connect(impersonatedSigners[governor]).removeBridgeToken(bridgeToken.address)
      ).wait();
      inReceipt(receipt, 'BridgeTokenRemoved', {
        bridgeToken: bridgeToken.address,
      });
      expect((await agToken.bridges(bridgeToken.address)).paused).to.be.equal(false);
      expect((await agToken.bridges(bridgeToken.address)).limit).to.be.equal(parseEther('0'));
      expect((await agToken.bridges(bridgeToken.address)).allowed).to.be.equal(false);
      expect((await agToken.bridges(bridgeToken.address)).fee).to.be.equal(parseAmount.gwei(0));
      // Adding it again to reset state
      await agToken
        .connect(impersonatedSigners[governor])
        .addBridgeToken(bridgeToken.address, parseEther('100'), parseEther('10'), parseAmount.gwei(0.03), true);
    });
    it('success - when there are two tokens and first one is removed', async () => {
      await agToken
        .connect(impersonatedSigners[governor])
        .addBridgeToken(bridgeToken2.address, parseEther('100'), parseEther('10'), parseAmount.gwei(0.03), true);
      const receipt = await (
        await agToken.connect(impersonatedSigners[governor]).removeBridgeToken(bridgeToken.address)
      ).wait();
      inReceipt(receipt, 'BridgeTokenRemoved', {
        bridgeToken: bridgeToken.address,
      });
      expect((await agToken.bridges(bridgeToken.address)).paused).to.be.equal(false);
      expect((await agToken.bridges(bridgeToken.address)).limit).to.be.equal(parseEther('0'));
      expect((await agToken.bridges(bridgeToken.address)).allowed).to.be.equal(false);
      expect((await agToken.bridges(bridgeToken.address)).fee).to.be.equal(parseAmount.gwei(0));
      expect(await agToken.bridgeTokensList(0)).to.be.equal(bridgeToken2.address);
      expect((await agToken.allBridgeTokens())[0]).to.be.equal(bridgeToken2.address);
      // Adding it again to reset state
      await agToken
        .connect(impersonatedSigners[governor])
        .addBridgeToken(bridgeToken.address, parseEther('100'), parseEther('10'), parseAmount.gwei(0.03), true);
    });
    it('success - when there are two tokens and second one is removed', async () => {
      // bridgeToken2 is still here
      const receipt = await (
        await agToken.connect(impersonatedSigners[governor]).removeBridgeToken(bridgeToken.address)
      ).wait();
      inReceipt(receipt, 'BridgeTokenRemoved', {
        bridgeToken: bridgeToken.address,
      });
      expect((await agToken.bridges(bridgeToken.address)).paused).to.be.equal(false);
      expect((await agToken.bridges(bridgeToken.address)).limit).to.be.equal(parseEther('0'));
      expect((await agToken.bridges(bridgeToken.address)).allowed).to.be.equal(false);
      expect((await agToken.bridges(bridgeToken.address)).fee).to.be.equal(parseAmount.gwei(0));
      expect(await agToken.bridgeTokensList(0)).to.be.equal(bridgeToken2.address);
      expect((await agToken.allBridgeTokens())[0]).to.be.equal(bridgeToken2.address);
      // Resetting state
      // Adding it again to reset state
      await agToken
        .connect(impersonatedSigners[governor])
        .addBridgeToken(bridgeToken.address, parseEther('100'), parseEther('10'), parseAmount.gwei(0.03), true);
    });
  });

  describe('recoverERC20', () => {
    it('reverts - non governor', async () => {
      await expect(
        agToken.connect(bob).recoverERC20(bridgeToken.address, bob.address, parseEther('1')),
      ).to.be.revertedWith('NotGovernor');
    });
    it('reverts - invalid balance', async () => {
      await expect(
        agToken.connect(impersonatedSigners[governor]).recoverERC20(bridgeToken.address, bob.address, parseEther('1')),
      ).to.be.reverted;
    });
    it('success - amount transfered', async () => {
      await bridgeToken.mint(agToken.address, parseEther('1'));
      expect(await bridgeToken.balanceOf(agToken.address)).to.be.equal(parseEther('1'));
      const receipt = await (
        await agToken
          .connect(impersonatedSigners[governor])
          .recoverERC20(bridgeToken.address, bob.address, parseEther('1'))
      ).wait();
      expect(await bridgeToken.balanceOf(agToken.address)).to.be.equal(parseEther('0'));
      inReceipt(receipt, 'Recovered', {
        token: bridgeToken.address,
        to: bob.address,
        amount: parseEther('1'),
      });
    });
  });

  describe('setLimit', () => {
    it('reverts - non governor and non guardian', async () => {
      await expect(agToken.connect(alice).setLimit(bridgeToken.address, parseEther('1'))).to.be.revertedWith(
        'NotGovernorOrGuardian',
      );
    });
    it('reverts - non allowed token', async () => {
      await expect(
        agToken.connect(impersonatedSigners[governor]).setLimit(alice.address, parseEther('1')),
      ).to.be.revertedWith('InvalidToken');
    });
    it('success - value updated', async () => {
      const receipt = await (
        await agToken.connect(impersonatedSigners[governor]).setLimit(bridgeToken.address, parseEther('1000'))
      ).wait();
      inReceipt(receipt, 'BridgeTokenLimitUpdated', {
        bridgeToken: bridgeToken.address,
        limit: parseEther('1000'),
      });
      expect((await agToken.bridges(bridgeToken.address)).limit).to.be.equal(parseEther('1000'));
    });
  });

  describe('setHourlyLimit', () => {
    it('reverts - non governor and non guardian and non keeper', async () => {
      await expect(agToken.connect(alice).setHourlyLimit(bridgeToken.address, parseEther('1'))).to.be.revertedWith(
        'NotGovernorOrGuardian',
      );
    });
    it('reverts - non allowed token', async () => {
      await expect(
        agToken.connect(impersonatedSigners[governor]).setHourlyLimit(alice.address, parseEther('1')),
      ).to.be.revertedWith('InvalidToken');
    });
    it('success - value updated', async () => {
      const receipt = await (
        await agToken.connect(impersonatedSigners[governor]).setHourlyLimit(bridgeToken.address, parseEther('1000'))
      ).wait();
      inReceipt(receipt, 'BridgeTokenHourlyLimitUpdated', {
        bridgeToken: bridgeToken.address,
        hourlyLimit: parseEther('1000'),
      });
      expect((await agToken.bridges(bridgeToken.address)).hourlyLimit).to.be.equal(parseEther('1000'));
    });
  });

  describe('setSwapFee', () => {
    it('reverts - non governor and non guardian', async () => {
      await expect(agToken.connect(alice).setSwapFee(bridgeToken.address, parseAmount.gwei('0.5'))).to.be.revertedWith(
        'NotGovernorOrGuardian',
      );
    });
    it('reverts - non allowed token', async () => {
      await expect(
        agToken.connect(impersonatedSigners[governor]).setSwapFee(alice.address, parseAmount.gwei('0.5')),
      ).to.be.revertedWith('InvalidToken');
    });
    it('reverts - too high value', async () => {
      await expect(
        agToken.connect(impersonatedSigners[governor]).setSwapFee(bridgeToken.address, parseAmount.gwei('2')),
      ).to.be.revertedWith('TooHighParameterValue');
    });
    it('success - value updated', async () => {
      const receipt = await (
        await agToken.connect(impersonatedSigners[governor]).setSwapFee(bridgeToken.address, parseAmount.gwei('0.001'))
      ).wait();
      inReceipt(receipt, 'BridgeTokenFeeUpdated', {
        bridgeToken: bridgeToken.address,
        fee: parseAmount.gwei('0.001'),
      });
      expect((await agToken.bridges(bridgeToken.address)).fee).to.be.equal(parseAmount.gwei('0.001'));
    });
  });

  describe('toggleBridge', () => {
    it('reverts - non governor and non guardian', async () => {
      await expect(agToken.connect(alice).toggleBridge(bridgeToken.address)).to.be.revertedWith(
        'NotGovernorOrGuardian',
      );
    });
    it('reverts - non existing bridge', async () => {
      await expect(agToken.connect(impersonatedSigners[governor]).toggleBridge(alice.address)).to.be.revertedWith(
        'InvalidToken',
      );
    });
    it('success - bridge unpaused', async () => {
      const receipt = await (
        await agToken.connect(impersonatedSigners[governor]).toggleBridge(bridgeToken.address)
      ).wait();
      inReceipt(receipt, 'BridgeTokenToggled', {
        bridgeToken: bridgeToken.address,
        toggleStatus: false,
      });
      expect((await agToken.bridges(bridgeToken.address)).paused).to.be.equal(false);
    });
    it('success - bridge paused', async () => {
      const receipt = await (
        await agToken.connect(impersonatedSigners[governor]).toggleBridge(bridgeToken.address)
      ).wait();
      inReceipt(receipt, 'BridgeTokenToggled', {
        bridgeToken: bridgeToken.address,
        toggleStatus: true,
      });
      expect((await agToken.bridges(bridgeToken.address)).paused).to.be.equal(true);
      // Resetting state
      await agToken.connect(impersonatedSigners[governor]).toggleBridge(bridgeToken.address);
    });
  });
  describe('toggleFeesForAddress', () => {
    it('reverts - non governor and non guardian', async () => {
      await expect(agToken.connect(alice).toggleFeesForAddress(bridgeToken.address)).to.be.revertedWith(
        'NotGovernorOrGuardian',
      );
    });
    it('success - address exempted', async () => {
      const receipt = await (
        await agToken.connect(impersonatedSigners[governor]).toggleFeesForAddress(alice.address)
      ).wait();
      inReceipt(receipt, 'FeeToggled', {
        theAddress: alice.address,
        toggleStatus: 1,
      });
      expect(await agToken.isFeeExempt(alice.address)).to.be.equal(1);
    });
    it('success - address unexempted', async () => {
      const receipt = await (
        await agToken.connect(impersonatedSigners[governor]).toggleFeesForAddress(alice.address)
      ).wait();
      inReceipt(receipt, 'FeeToggled', {
        theAddress: alice.address,
        toggleStatus: 0,
      });
      expect(await agToken.isFeeExempt(alice.address)).to.be.equal(0);
    });
  });

  describe('swapIn', () => {
    it('reverts - incorrect bridge token', async () => {
      await expect(
        agToken.connect(impersonatedSigners[governor]).swapIn(bob.address, parseEther('1'), alice.address),
      ).to.be.revertedWith('InvalidToken');
    });
    it('reverts - bridge token paused', async () => {
      await agToken.connect(impersonatedSigners[governor]).toggleBridge(bridgeToken.address);
      await expect(
        agToken.connect(impersonatedSigners[governor]).swapIn(bridgeToken.address, parseEther('1'), alice.address),
      ).to.be.revertedWith('InvalidToken');
      // Resetting state
      await agToken.connect(impersonatedSigners[governor]).toggleBridge(bridgeToken.address);
    });
    it('success - zero limit swaps 0', async () => {
      await agToken.connect(impersonatedSigners[governor]).setLimit(bridgeToken.address, parseEther('0'));
      await agToken.connect(impersonatedSigners[governor]).swapIn(bridgeToken.address, parseEther('1'), alice.address);
      expect(await agToken.balanceOf(bob.address)).to.be.equal(parseEther('0'));
    });
    it('success - amount greater than limit', async () => {
      await agToken.connect(impersonatedSigners[governor]).setLimit(bridgeToken.address, parseEther('10'));
      await agToken.connect(impersonatedSigners[governor]).setHourlyLimit(bridgeToken.address, parseEther('10'));
      await agToken.connect(impersonatedSigners[governor]).setSwapFee(bridgeToken.address, parseEther('0'));
      await bridgeToken.mint(deployer.address, parseEther('100'));
      await bridgeToken.connect(deployer).approve(agToken.address, parseEther('100'));
      await agToken.connect(deployer).swapIn(bridgeToken.address, parseEther('100'), bob.address);
      expect(await agToken.balanceOf(bob.address)).to.be.equal(parseEther('10'));
      expect(await bridgeToken.balanceOf(deployer.address)).to.be.equal(parseEther('90'));
      expect(await agToken.currentUsage(bridgeToken.address)).to.be.equal(parseEther('10'));

      // Resetting state
      await time.increase(3600);
      await agToken.connect(bob).swapOut(bridgeToken.address, parseEther('10'), deployer.address);
      await bridgeToken.burn(deployer.address, parseEther('100'));
    });
    it('success - amount greater than hourlyLimit', async () => {
      await agToken.connect(impersonatedSigners[governor]).setLimit(bridgeToken.address, parseEther('10'));
      await agToken.connect(impersonatedSigners[governor]).setHourlyLimit(bridgeToken.address, parseEther('1'));
      await agToken.connect(impersonatedSigners[governor]).setSwapFee(bridgeToken.address, parseEther('0'));
      await bridgeToken.mint(deployer.address, parseEther('2'));
      await bridgeToken.connect(deployer).approve(agToken.address, parseEther('2'));
      expect(await agToken.balanceOf(bob.address)).to.be.equal(parseEther('0'));
      await agToken.connect(deployer).swapIn(bridgeToken.address, parseEther('2'), bob.address);
      expect(await agToken.balanceOf(bob.address)).to.be.equal(parseEther('1'));
      expect(await bridgeToken.balanceOf(deployer.address)).to.be.equal(parseEther('1'));
      expect(await agToken.currentUsage(bridgeToken.address)).to.be.equal(parseEther('1'));

      // Resetting state
      await time.increase(3600);
      await agToken.connect(bob).swapOut(bridgeToken.address, parseEther('1'), deployer.address);
      await bridgeToken.burn(deployer.address, parseEther('2'));
    });
    it('success - total amount greater than hourlyLimit', async () => {
      await agToken.connect(impersonatedSigners[governor]).setLimit(bridgeToken.address, parseEther('10'));
      await agToken.connect(impersonatedSigners[governor]).setHourlyLimit(bridgeToken.address, parseEther('2'));
      await bridgeToken.mint(deployer.address, parseEther('3'));
      await bridgeToken.connect(deployer).approve(agToken.address, parseEther('3'));
      await agToken.connect(deployer).swapIn(bridgeToken.address, parseEther('1'), bob.address);
      expect(await agToken.currentUsage(bridgeToken.address)).to.be.equal(parseEther('1'));
      await agToken.connect(deployer).swapIn(bridgeToken.address, parseEther('2'), bob.address);
      expect(await agToken.balanceOf(bob.address)).to.be.equal(parseEther('2'));
      expect(await bridgeToken.balanceOf(deployer.address)).to.be.equal(parseEther('1'));
      expect(await agToken.currentUsage(bridgeToken.address)).to.be.equal(parseEther('2'));

      // Resetting state
      await time.increase(3600);
      await agToken.connect(bob).swapOut(bridgeToken.address, parseEther('2'), deployer.address);
      await bridgeToken.burn(deployer.address, parseEther('3'));
    });
    it('success - hourlyLimit over 2 hours', async () => {
      await agToken.connect(impersonatedSigners[governor]).setSwapFee(bridgeToken.address, parseAmount.gwei('0'));
      await agToken.connect(impersonatedSigners[governor]).setLimit(bridgeToken.address, parseEther('10'));
      await agToken.connect(impersonatedSigners[governor]).setHourlyLimit(bridgeToken.address, parseEther('2'));
      await bridgeToken.mint(deployer.address, parseEther('3'));
      await bridgeToken.connect(deployer).approve(agToken.address, parseEther('3'));
      await (await agToken.connect(deployer).swapIn(bridgeToken.address, parseEther('1'), bob.address)).wait();
      expect(await bridgeToken.balanceOf(agToken.address)).to.be.equal(parseEther('1'));
      expect(await bridgeToken.balanceOf(deployer.address)).to.be.equal(parseEther('2'));
      expect(await agToken.balanceOf(bob.address)).to.be.equal(parseEther('1'));
      expect(await agToken.currentUsage(bridgeToken.address)).to.be.equal(parseEther('1'));
      let hour = Math.floor((await time.latest()) / 3600);
      expect(await agToken.usage(bridgeToken.address, hour)).to.be.equal(parseEther('1'));
      await time.increase(3600);
      hour = Math.floor((await time.latest()) / 3600);
      expect(await agToken.usage(bridgeToken.address, hour - 1)).to.be.equal(parseEther('1'));
      expect(await agToken.usage(bridgeToken.address, hour)).to.be.equal(parseEther('0'));
      expect(await agToken.currentUsage(bridgeToken.address)).to.be.equal(parseEther('0'));
      await (await agToken.connect(deployer).swapIn(bridgeToken.address, parseEther('2'), bob.address)).wait();
      expect(await agToken.usage(bridgeToken.address, hour)).to.be.equal(parseEther('2'));
      expect(await bridgeToken.balanceOf(agToken.address)).to.be.equal(parseEther('3'));
      expect(await bridgeToken.balanceOf(deployer.address)).to.be.equal(parseEther('0'));
      expect(await agToken.balanceOf(bob.address)).to.be.equal(parseEther('3'));

      // Resetting state
      await time.increase(3600);
      await agToken.connect(bob).swapOut(bridgeToken.address, parseEther('3'), deployer.address);
      await bridgeToken.burn(deployer.address, parseEther('3'));
    });
    it('success - with some transaction fees', async () => {
      await agToken.connect(impersonatedSigners[governor]).setSwapFee(bridgeToken.address, parseAmount.gwei('0.5'));
      await agToken.connect(impersonatedSigners[governor]).setLimit(bridgeToken.address, parseEther('100'));
      await agToken.connect(impersonatedSigners[governor]).setHourlyLimit(bridgeToken.address, parseEther('100'));
      await bridgeToken.mint(deployer.address, parseEther('10'));
      await bridgeToken.connect(deployer).approve(agToken.address, parseEther('10'));
      const agTokenBalance = await bridgeToken.balanceOf(agToken.address);
      const receipt = await (
        await agToken.connect(deployer).swapIn(bridgeToken.address, parseEther('10'), bob.address)
      ).wait();
      expect(await bridgeToken.balanceOf(deployer.address)).to.be.equal(parseEther('0'));
      expect(await agToken.balanceOf(bob.address)).to.be.equal(parseEther('5'));
      inIndirectReceipt(
        receipt,
        new utils.Interface(['event Transfer(address indexed from, address indexed to, uint256 value)']),
        'Transfer',
        {
          from: deployer.address,
          to: agToken.address,
          value: parseEther('10'),
        },
      );
      expect(await bridgeToken.balanceOf(agToken.address)).to.be.equal(agTokenBalance.add(parseEther('10')));
    });
    it('success - with some transaction fees and exempt address', async () => {
      await agToken.connect(impersonatedSigners[governor]).toggleFeesForAddress(deployer.address);
      await agToken.connect(impersonatedSigners[governor]).setSwapFee(bridgeToken.address, parseAmount.gwei('0.5'));
      await agToken.connect(impersonatedSigners[governor]).setLimit(bridgeToken.address, parseEther('100'));
      await agToken.connect(impersonatedSigners[governor]).setHourlyLimit(bridgeToken.address, parseEther('100'));
      await bridgeToken.mint(deployer.address, parseEther('10'));
      await bridgeToken.connect(deployer).approve(agToken.address, parseEther('10'));
      const agTokenBalance = await bridgeToken.balanceOf(agToken.address);
      const bobBalance = await agToken.balanceOf(bob.address);
      const receipt = await (
        await agToken.connect(deployer).swapIn(bridgeToken.address, parseEther('10'), bob.address)
      ).wait();
      expect(await bridgeToken.balanceOf(deployer.address)).to.be.equal(parseEther('0'));
      expect(await agToken.balanceOf(bob.address)).to.be.equal(parseEther('10').add(bobBalance));
      inIndirectReceipt(
        receipt,
        new utils.Interface(['event Transfer(address indexed from, address indexed to, uint256 value)']),
        'Transfer',
        {
          from: deployer.address,
          to: agToken.address,
          value: parseEther('10'),
        },
      );
      expect(await bridgeToken.balanceOf(agToken.address)).to.be.equal(parseEther('10').add(agTokenBalance));
      // Resetting state
      await agToken.connect(impersonatedSigners[governor]).toggleFeesForAddress(deployer.address);
    });
    it('success - with no transaction fees and non exempt address', async () => {
      await agToken.connect(impersonatedSigners[governor]).setSwapFee(bridgeToken.address, parseAmount.gwei('0'));
      await agToken.connect(impersonatedSigners[governor]).setLimit(bridgeToken.address, parseEther('100'));
      await agToken.connect(impersonatedSigners[governor]).setHourlyLimit(bridgeToken.address, parseEther('100'));
      await bridgeToken.mint(deployer.address, parseEther('10'));
      await bridgeToken.connect(deployer).approve(agToken.address, parseEther('10'));

      const agTokenBalance = await bridgeToken.balanceOf(agToken.address);
      const bobBalance = await agToken.balanceOf(bob.address);
      const receipt = await (
        await agToken.connect(deployer).swapIn(bridgeToken.address, parseEther('10'), bob.address)
      ).wait();

      expect(await bridgeToken.balanceOf(deployer.address)).to.be.equal(parseEther('0'));
      expect(await agToken.balanceOf(bob.address)).to.be.equal(parseEther('10').add(bobBalance));
      inIndirectReceipt(
        receipt,
        new utils.Interface(['event Transfer(address indexed from, address indexed to, uint256 value)']),
        'Transfer',
        {
          from: deployer.address,
          to: agToken.address,
          value: parseEther('10'),
        },
      );
      expect(await bridgeToken.balanceOf(agToken.address)).to.be.equal(parseEther('10').add(agTokenBalance));
    });
    it('success - with weird transaction fees', async () => {
      await agToken.connect(impersonatedSigners[governor]).setSwapFee(bridgeToken.address, parseAmount.gwei('0.0004'));
      await agToken.connect(impersonatedSigners[governor]).setLimit(bridgeToken.address, parseEther('1000'));
      await agToken.connect(impersonatedSigners[governor]).setHourlyLimit(bridgeToken.address, parseEther('1000'));
      await bridgeToken.mint(deployer.address, parseEther('100'));
      await bridgeToken.connect(deployer).approve(agToken.address, parseEther('100'));
      const agTokenBalance = await bridgeToken.balanceOf(agToken.address);
      const bobBalance = await agToken.balanceOf(bob.address);
      const receipt = await (
        await agToken.connect(deployer).swapIn(bridgeToken.address, parseEther('100'), bob.address)
      ).wait();
      expect(await bridgeToken.balanceOf(agToken.address)).to.be.equal(parseEther('100').add(agTokenBalance));
      expect(await bridgeToken.balanceOf(deployer.address)).to.be.equal(parseEther('0'));
      expect(await agToken.balanceOf(bob.address)).to.be.equal(parseEther('99.96').add(bobBalance));
      inIndirectReceipt(
        receipt,
        new utils.Interface(['event Transfer(address indexed from, address indexed to, uint256 value)']),
        'Transfer',
        {
          from: deployer.address,
          to: agToken.address,
          value: parseEther('100'),
        },
      );
    });
    it('success - hourlyLimit over 2 hours', async () => {
      await agToken.connect(impersonatedSigners[governor]).setSwapFee(bridgeToken.address, parseAmount.gwei('0'));
      await agToken.connect(impersonatedSigners[governor]).setLimit(bridgeToken.address, parseEther('1000'));
      await agToken.connect(impersonatedSigners[governor]).setHourlyLimit(bridgeToken.address, parseEther('2'));
      await bridgeToken.mint(deployer.address, parseEther('3'));
      await bridgeToken.connect(deployer).approve(agToken.address, parseEther('3'));
      await time.increase(3600);
      await (await agToken.connect(deployer).swapIn(bridgeToken.address, parseEther('1'), bob.address)).wait();
      let hour = Math.floor((await time.latest()) / 3600);
      console.log((await agToken.usage(bridgeToken.address, hour - 1))?.toString());
      console.log((await agToken.usage(bridgeToken.address, hour))?.toString());
      console.log((await agToken.usage(bridgeToken.address, hour + 1))?.toString());
      expect(await agToken.usage(bridgeToken.address, hour)).to.be.equal(parseEther('1'));
      expect(await agToken.currentUsage(bridgeToken.address)).to.be.equal(parseEther('1'));
      await time.increase(3600);
      hour = Math.floor((await time.latest()) / 3600);
      expect(await agToken.usage(bridgeToken.address, hour - 1)).to.be.equal(parseEther('1'));
      expect(await agToken.usage(bridgeToken.address, hour)).to.be.equal(parseEther('0'));
      await (await agToken.connect(deployer).swapIn(bridgeToken.address, parseEther('2'), bob.address)).wait();
      expect(await agToken.currentUsage(bridgeToken.address)).to.be.equal(parseEther('2'));
      expect(await agToken.usage(bridgeToken.address, hour)).to.be.equal(parseEther('2'));
    });
  });

  describe('swapOut', () => {
    it('reverts - incorrect bridge token', async () => {
      await expect(
        agToken.connect(impersonatedSigners[governor]).swapOut(bob.address, parseEther('1'), alice.address),
      ).to.be.revertedWith('InvalidToken');
    });
    it('reverts - bridge token paused', async () => {
      await agToken.connect(impersonatedSigners[governor]).toggleBridge(bridgeToken.address);
      await expect(
        agToken.connect(impersonatedSigners[governor]).swapOut(bridgeToken.address, parseEther('1'), alice.address),
      ).to.be.revertedWith('InvalidToken');
      await agToken.connect(impersonatedSigners[governor]).toggleBridge(bridgeToken.address);
    });
    it('reverts - invalid agToken balance', async () => {
      await expect(
        agToken.connect(impersonatedSigners[governor]).swapOut(bridgeToken.address, parseEther('1'), alice.address),
      ).to.be.reverted;
    });
    it('reverts - invalid bridgeToken balance', async () => {
      await agToken.connect(impersonatedSigners[governor]).setSwapFee(bridgeToken.address, parseAmount.gwei('0.5'));
      expect(await agToken.isMinter(alice.address)).to.be.equal(false);
      await treasury.connect(impersonatedSigners[governor]).addMinter(alice.address);
      await agToken.connect(alice).mint(deployer.address, parseEther('100'));
      await expect(
        agToken
          .connect(impersonatedSigners[polygonGovernor])
          .swapOut(bridgeToken.address, parseEther('1'), alice.address),
      ).to.be.reverted;
    });
    it('success - with a valid bridgeToken balance', async () => {
      await agToken.connect(impersonatedSigners[governor]).setSwapFee(bridgeToken.address, parseAmount.gwei('0.5'));
      await agToken.connect(alice).mint(deployer.address, parseEther('100'));
      await bridgeToken.connect(impersonatedSigners[governor]).mint(agToken.address, parseEther('100'));
      const deployerBalance = await agToken.balanceOf(deployer.address);
      const bobBalance = await bridgeToken.balanceOf(bob.address);
      const agTokenBalance = await bridgeToken.balanceOf(agToken.address);
      await agToken.connect(deployer).swapOut(bridgeToken.address, parseEther('100'), bob.address);
      expect(await agToken.balanceOf(deployer.address)).to.be.equal(deployerBalance.sub(parseEther('100')));
      expect(await bridgeToken.balanceOf(bob.address)).to.be.equal(bobBalance.add(parseEther('50')));
      expect(await bridgeToken.balanceOf(agToken.address)).to.be.equal(agTokenBalance.sub(parseEther('50')));
    });
    it('success - with a valid bridgeToken balance but a fee exemption', async () => {
      await agToken.connect(impersonatedSigners[governor]).toggleFeesForAddress(deployer.address);
      await agToken.connect(impersonatedSigners[governor]).setSwapFee(bridgeToken.address, parseAmount.gwei('0.5'));
      await agToken.connect(alice).mint(deployer.address, parseEther('100'));

      await bridgeToken.connect(impersonatedSigners[governor]).mint(agToken.address, parseEther('100'));
      const deployerBalance = await agToken.balanceOf(deployer.address);
      const bobBalance = await bridgeToken.balanceOf(bob.address);
      const agTokenBalance = await bridgeToken.balanceOf(agToken.address);
      const receipt = await (
        await agToken.connect(deployer).swapOut(bridgeToken.address, parseEther('100'), bob.address)
      ).wait();
      inIndirectReceipt(
        receipt,
        new utils.Interface(['event Transfer(address indexed from, address indexed to, uint256 value)']),
        'Transfer',
        {
          from: agToken.address,
          to: bob.address,
          value: parseEther('100'),
        },
      );
      expect(await agToken.balanceOf(deployer.address)).to.be.equal(deployerBalance.sub(parseEther('100')));
      expect(await bridgeToken.balanceOf(bob.address)).to.be.equal(bobBalance.add(parseEther('100')));
      expect(await bridgeToken.balanceOf(agToken.address)).to.be.equal(agTokenBalance.sub(parseEther('100')));
      // Reset state
      await agToken.connect(impersonatedSigners[governor]).toggleFeesForAddress(deployer.address);
    });
    it('success - with weird transaction fees', async () => {
      await agToken.connect(impersonatedSigners[governor]).setSwapFee(bridgeToken.address, parseAmount.gwei('0.0004'));
      await agToken.connect(alice).mint(deployer.address, parseEther('100'));
      await bridgeToken.connect(impersonatedSigners[governor]).mint(agToken.address, parseEther('100'));
      const deployerBalance = await agToken.balanceOf(deployer.address);
      const bobBalance = await bridgeToken.balanceOf(bob.address);
      const agTokenBalance = await bridgeToken.balanceOf(agToken.address);
      await agToken.connect(deployer).swapOut(bridgeToken.address, parseEther('100'), bob.address);
      expect(await agToken.balanceOf(deployer.address)).to.be.equal(deployerBalance.sub(parseEther('100')));
      expect(await bridgeToken.balanceOf(bob.address)).to.be.equal(bobBalance.add(parseEther('99.96')));
      expect(await bridgeToken.balanceOf(agToken.address)).to.be.equal(agTokenBalance.sub(parseEther('99.96')));
    });
  });
  describe('setTreasury', () => {
    it('reverts - non treasury', async () => {
      await expect(agToken.connect(charlie).setTreasury(alice.address)).to.be.revertedWith('NotTreasury');
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
});
