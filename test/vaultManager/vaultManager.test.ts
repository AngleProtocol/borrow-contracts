import { CONTRACTS_ADDRESSES } from '@angleprotocol/sdk';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { Signer } from 'ethers';
import { parseEther, parseUnits } from 'ethers/lib/utils';
import hre, { contract, ethers } from 'hardhat';

import {
  AgToken,
  AgToken__factory,
  MockERC20,
  MockERC20__factory,
  MockOracle,
  MockOracle__factory,
  MockStableMaster,
  MockStableMaster__factory,
  MockTreasury,
  MockTreasury__factory,
  VaultManager,
  VaultManager__factory,
} from '../../typechain';
import { expect } from '../utils/chai-setup';
import { deployUpgradeable, ZERO_ADDRESS } from '../utils/helpers';

contract('VaultManager', () => {
  let deployer: SignerWithAddress;
  let governor: SignerWithAddress;
  let guardian: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let charlie: SignerWithAddress;

  let treasury: MockTreasury;
  let collateral: MockERC20;
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
    collateralFactor: parseUnits('2', 'gwei'),
    targetHealthFactor: parseUnits('3', 'gwei'),
    borrowFee: parseUnits('0.1', 'gwei'),
    interestRate: 100,
    liquidationSurcharge: parseUnits('0.1', 'gwei'),
    maxLiquidationDiscount: parseUnits('0.1', 'gwei'),
    liquidationBooster: parseUnits('0.1', 'gwei'),
    whitelistingActivated: false,
  };

  before(async () => {
    [deployer, alice, bob, charlie, governor, guardian] = await ethers.getSigners();
    // add any addresses you want to impersonate here
    const impersonatedAddresses = [CONTRACTS_ADDRESSES[1].Governor!];

    for (const address of impersonatedAddresses) {
      await hre.network.provider.request({
        method: 'hardhat_impersonateAccount',
        params: [address],
      });

      impersonatedSigners[address] = await ethers.getSigner(address);
    }
  });

  beforeEach(async () => {
    // If the forked-network state needs to be reset between each test, run this
    // await network.provider.request({method: 'hardhat_reset', params: []});

    stableMaster = await new MockStableMaster__factory(deployer).deploy();

    agToken = (await deployUpgradeable(new AgToken__factory(deployer))) as AgToken;
    await agToken.connect(deployer).initialize('agEUR', 'agEUR', stableMaster.address);

    collateral = await new MockERC20__factory(deployer).deploy('A', 'A', collatBase);

    vaultManager = (await deployUpgradeable(new VaultManager__factory(deployer))) as VaultManager;

    treasury = await new MockTreasury__factory(deployer).deploy(
      agToken.address,
      governor.address,
      guardian.address,
      vaultManager.address,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
    );

    oracle = await new MockOracle__factory(deployer).deploy(2 * 10 ** collatBase, collatBase, treasury.address);
  });

  describe('initializer', () => {
    it('revert - oracle treasury differs', async () => {
      oracle = await new MockOracle__factory(deployer).deploy(2 * 10 ** collatBase, collatBase, ZERO_ADDRESS);
      const tx = vaultManager.initialize(treasury.address, collateral.address, oracle.address, 'EX', params);
      expect(tx).to.rejectedWith('33');
    });

    it('success', async () => {
      await vaultManager.initialize(treasury.address, collateral.address, oracle.address, 'EX', params);
      expect(await vaultManager.oracle()).to.be.equal(oracle.address);
      expect(await vaultManager.treasury()).to.be.equal(treasury.address);
      expect(await vaultManager.collateral()).to.be.equal(collateral.address);
      expect(await vaultManager.collatBase()).to.be.equal(10 ** collatBase);
      expect(await vaultManager.stablecoin()).to.be.equal(agToken.address);
      console.log(await vaultManager.name());
      console.log(await vaultManager.symbol());
    });
  });
});
