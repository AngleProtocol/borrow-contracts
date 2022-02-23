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
  const vaultSymbol = 'EXAMPLE';
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

    collateral = await new MockToken__factory(deployer).deploy('A', 'A', collatBase);

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
    await vaultManager.initialize(treasury.address, collateral.address, oracle.address, vaultSymbol, params);
    await vaultManager.connect(guardian).unpause();
  });

  describe('angle', () => {
    it('createVault', async () => {
      await angle(vaultManager, alice, [createVault(alice.address)]);
      expect(await vaultManager.supportsInterface('0x55555555')).to.be.false;
    });
  });
});
