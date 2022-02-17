import { ethers, web3 } from 'hardhat';
import { BigNumber, Contract, ContractFactory } from 'ethers';
import { parseAmount, multBy10e15 } from '../../utils/bignumber';

import {
  AgToken,
  CoreBorrow,
  ProxyAdmin,
  TransparentUpgradeableProxy,
  FlashAngle,
  OracleChainlinkMulti,
  Treasury,
  VaultManager,
  MockStableMaster,
  MockTreasury,
} from '../../typechain';
import { expect } from './chai-setup';

import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

export async function initAgTokenWithMock(
  governor: SignerWithAddress,
  name: string,
): Promise<{
  agToken: AgToken;
  agTokenImplementation: AgToken;
  stableMaster: MockStableMaster;
}> {
  const AgTokenArtifacts = await ethers.getContractFactory('AgToken');
  const ProxyAdminArtifacts = await ethers.getContractFactory('ProxyAdmin');
  const TransparentUpgradeableProxyArtifacts = await ethers.getContractFactory('TransparentUpgradeableProxy');
  const MockStableMasterArtifacts = await ethers.getContractFactory('MockStableMaster');
  const MockTreasuryArtifacts = await ethers.getContractFactory('MockTreasury');

  const agTokenImplementation = (await AgTokenArtifacts.deploy()) as AgToken;
  const proxyAdmin = (await ProxyAdminArtifacts.deploy()) as ProxyAdmin;
  const stableMaster = (await MockStableMasterArtifacts.deploy()) as MockStableMaster;
  const treasury = (await MockStableMasterArtifacts.deploy()) as MockStableMaster;
  const dataAgTokenInitialization = new ethers.Contract(agTokenImplementation.address, [
    'function initialize(string,string,address)',
  ]).interface.encodeFunctionData('initialize', [name, name, stableMaster.address]);

  const agToken = (await TransparentUpgradeableProxyArtifacts.deploy(
    agTokenImplementation.address,
    proxyAdmin.address,
    dataAgTokenInitialization,
  )) as AgToken;
  // Does not work
  console.log(await agToken.stableMaster());

  return { agToken, agTokenImplementation, stableMaster };
}

export async function getUpgradeabilityArtifacts(): Promise<{
  proxyAdmin: ProxyAdmin;
  TransparentUpgradeableProxyArtifacts: ContractFactory;
}> {
  const ProxyAdminArtifacts = await ethers.getContractFactory('ProxyAdmin');
  const TransparentUpgradeableProxyArtifacts = await ethers.getContractFactory('TransparentUpgradeableProxy');
  const proxyAdmin = (await ProxyAdminArtifacts.deploy({})) as ProxyAdmin;
  return { proxyAdmin, TransparentUpgradeableProxyArtifacts };
}
