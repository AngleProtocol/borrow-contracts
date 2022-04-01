import { ChainId, CONTRACTS_ADDRESSES } from '@angleprotocol/sdk';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import hre from 'hardhat';
import { DeployFunction } from 'hardhat-deploy/types';

import {
  AgToken,
  AgToken__factory,
  CoreBorrow,
  CoreBorrow__factory,
  FlashAngle,
  FlashAngle__factory,
  ProxyAdmin,
  ProxyAdmin__factory,
} from '../typechain';
import params from './networks';

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
  let flashAngle: FlashAngle;

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
    agTokenAddress = (await deployments.get('AgToken')).address;
  }
  proxyAdmin = new ethers.Contract(proxyAdminAddress, ProxyAdmin__factory.createInterface(), signer) as ProxyAdmin;

  const treasury = await deployments.get('Treasury');
  const coreBorrowAddress = await deployments.get('CoreBorrow');

  if (!network.live) {
    // We're just upgrading the agToken in mainnet fork
    console.log('Upgrading AgToken');
    const agTokenImplementation = await deployments.get('AgToken_Implementation');
    await (await proxyAdmin.connect(signer).upgrade(agTokenAddress, agTokenImplementation.address)).wait();
    console.log('Success');
    console.log('');
    agToken = new ethers.Contract(agTokenAddress, AgToken__factory.createInterface(), deployer) as AgToken;

    console.log('Setting up the treasury on the agToken');
    await (await agToken.connect(signer).setUpTreasury(treasury.address)).wait();
    console.log('Success');
    console.log('');
  }

  coreBorrow = new ethers.Contract(
    coreBorrowAddress.address,
    CoreBorrow__factory.createInterface(),
    signer,
  ) as CoreBorrow;

  console.log('Setting up the flash loan module parameter');
  if (params.stablesParameters.EUR.flashloan) {
    const flashLoanParams = params.stablesParameters.EUR.flashloan;
    const flashAngleAddress = await deployments.get('FlashAngle');
    flashAngle = (await new ethers.Contract(
      flashAngleAddress.address,
      FlashAngle__factory.createInterface(),
      signer,
    )) as FlashAngle;

    console.log('Setting up the flashAngle on the coreBorrow');
    await (await coreBorrow.setFlashLoanModule(flashAngle.address)).wait();
    console.log('Success');
    console.log('');

    console.log('Setting up the treasury on the flashAngle');
    await (await coreBorrow.connect(signer).addFlashLoanerTreasuryRole(treasury.address)).wait();
    console.log('Success');
    console.log('');

    console.log('Setting up flash loan parameters');
    await (
      await flashAngle.setFlashLoanParameters(
        agTokenAddress,
        flashLoanParams.flashLoanFee,
        flashLoanParams.maxBorrowable,
      )
    ).wait();
  }
  console.log('Success');
  console.log('');
};

func.tags = ['governanceFlashLoan'];
func.dependencies = ['vaultManagerProxy'];
export default func;
