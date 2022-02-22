import { DeployFunction } from 'hardhat-deploy/types';
import hre from 'hardhat';

import { CONTRACTS_ADDRESSES, ChainId } from '@angleprotocol/sdk';
import {
  AgToken,
  ProxyAdmin,
  ProxyAdmin__factory,
  AgToken__factory,
  CoreBorrow,
  CoreBorrow__factory,
} from '../typechain';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

const func: DeployFunction = async ({ deployments, ethers, network }) => {
  const { deployer } = await ethers.getNamedSigners();
  const json = await import('./networks/' + network.name + '.json');
  const governor = json.governor;
  let proxyAdminAddress: string;
  let agTokenAddress: string;
  let proxyAdmin: ProxyAdmin;
  let signer: SignerWithAddress;
  let agToken: AgToken;
  let coreBorrow: CoreBorrow;

  if (!network.live) {
    // If we're in mainnet fork, we're using the `ProxyAdmin` address from mainnet
    proxyAdminAddress = CONTRACTS_ADDRESSES[ChainId.MAINNET].ProxyAdmin!;
    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [governor],
    });
    await hre.network.provider.send('hardhat_setBalance', [governor, '0x10000000000000000000000000000']);
    signer = await ethers.getSigner(governor);
    agTokenAddress = CONTRACTS_ADDRESSES[ChainId.MAINNET].agEUR?.AgToken!;
  } else {
    // Otherwise, we're using the proxy admin address from the desired network
    proxyAdminAddress = CONTRACTS_ADDRESSES[network.config.chainId as ChainId].ProxyAdmin!;
    signer = deployer;
    agTokenAddress = CONTRACTS_ADDRESSES[network.config.chainId as ChainId].agEUR?.AgToken!;
  }
  proxyAdmin = new ethers.Contract(proxyAdminAddress, ProxyAdmin__factory.createInterface(), signer) as ProxyAdmin;
  const agTokenImplementation = await deployments.get('AgToken_Implementation');
  const treasury = await deployments.get('Treasury');
  const coreBorrowAddress = await deployments.get('CoreBorrow');
  console.log('Upgrading AgToken');
  await (await proxyAdmin.connect(signer).upgrade(agTokenAddress, agTokenImplementation.address)).wait();
  console.log('Success');
  console.log('');
  agToken = new ethers.Contract(agTokenAddress, AgToken__factory.createInterface(), deployer) as AgToken;

  coreBorrow = new ethers.Contract(
    coreBorrowAddress.address,
    CoreBorrow__factory.createInterface(),
    signer,
  ) as CoreBorrow;
  console.log('Setting up the treasury on the agToken');
  await (await agToken.connect(signer).setUpTreasury(treasury.address)).wait();
  console.log('Success');
  console.log('');
  console.log('Setting up the treasury on the flashAngle');
  await (await coreBorrow.connect(signer).addFlashLoanerTreasuryRole(treasury.address)).wait();
  console.log('Success');
  console.log('');

  /* TODO after this:
    - vaultManagers deployed and linked to the treasury
    - parameters in the FlashAngle contracts (for the flash loan) -> SDK
  */
};

func.tags = ['governanceTx'];
func.dependencies = ['agTokenImplementation'];
export default func;
