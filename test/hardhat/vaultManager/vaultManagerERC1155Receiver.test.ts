import { parseAmount } from '@angleprotocol/sdk';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { Signer } from 'ethers';
import { parseEther } from 'ethers/lib/utils';
import hre, { contract, ethers } from 'hardhat';

import {
  AgToken,
  AgToken__factory,
  AngleHelpers,
  AngleHelpers__factory,
  MockOracle,
  MockOracle__factory,
  MockStableMaster,
  MockStableMaster__factory,
  MockToken,
  MockToken__factory,
  MockTreasury,
  MockTreasury__factory,
  VaultManagerERC1155Receiver,
  VaultManagerERC1155Receiver__factory,
} from '../../../typechain';
import { expect } from '../utils/chai-setup';
import { deployUpgradeable, ZERO_ADDRESS } from '../utils/helpers';

contract('VaultManagerERC1155Receiver', () => {
  let deployer: SignerWithAddress;
  let governor: SignerWithAddress;
  let guardian: SignerWithAddress;

  let treasury: MockTreasury;
  let collateral: MockToken;
  let oracle: MockOracle;
  let stableMaster: MockStableMaster;
  let agToken: AgToken;
  let vaultManager: VaultManagerERC1155Receiver;
  let helpers: AngleHelpers;

  const impersonatedSigners: { [key: string]: Signer } = {};

  const collatBase = 10;
  const params = {
    debtCeiling: parseEther('100'),
    collateralFactor: 0.5e9,
    targetHealthFactor: 1.1e9,
    borrowFee: 0.1e9,
    interestRate: 100,
    liquidationSurcharge: 0.9e9,
    maxLiquidationDiscount: 0.1e9,
    liquidationBooster: 0.1e9,
    whitelistingActivated: false,
    baseBoost: 1e9,
  };

  before(async () => {
    ({ deployer, governor, guardian } = await ethers.getNamedSigners());
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
    stableMaster = await new MockStableMaster__factory(deployer).deploy();
    agToken = (await deployUpgradeable(new AgToken__factory(deployer))) as AgToken;
    await agToken.connect(deployer).initialize('agEUR', 'agEUR', stableMaster.address);
    collateral = await new MockToken__factory(deployer).deploy('USDC', 'USDC', collatBase);
    vaultManager = (await deployUpgradeable(
      new VaultManagerERC1155Receiver__factory(deployer),
    )) as VaultManagerERC1155Receiver;
    helpers = (await deployUpgradeable(new AngleHelpers__factory(deployer))) as AngleHelpers;

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

    oracle = await new MockOracle__factory(deployer).deploy(2 * 10 ** collatBase, treasury.address);
    await vaultManager.initialize(treasury.address, collateral.address, oracle.address, params, 'USDC/agEUR');
  });

  describe('ERC1155Receiver Logic', () => {
    it('success - onERC1155Received', async () => {
      expect(
        await vaultManager.onERC1155Received(
          guardian.address,
          guardian.address,
          parseEther('1'),
          parseEther('2'),
          '0x',
        ),
      ).to.be.equal('0xf23a6e61');
    });
    it('success - onERC1155BatchReceived', async () => {
      expect(
        await vaultManager.onERC1155BatchReceived(
          guardian.address,
          guardian.address,
          [parseAmount.gwei('1')],
          [parseEther('10')],
          '0x',
        ),
      ).to.be.equal('0xbc197c81');
    });
    it('success - supportsInterface', async () => {
      // Equal to: `type(IERC1155ReceiverUpgradeable).interfaceId`
      expect(await vaultManager.supportsInterface('0x4e2312e0')).to.be.equal(true);
    });
  });
});
