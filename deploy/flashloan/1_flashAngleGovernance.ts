import { ChainId, CONTRACTS_ADDRESSES } from '@angleprotocol/sdk';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import hre from 'hardhat';
import { DeployFunction } from 'hardhat-deploy/types';

import {
  CoreBorrow,
  CoreBorrow__factory,
  FlashAngle,
  FlashAngle__factory,
  ProxyAdmin,
  ProxyAdmin__factory,
  Treasury,
  Treasury__factory,
} from '../../typechain';
import { parseAmount } from '../../utils/bignumber';

const flashLoanParams = {
  // 3m at the moment, should not be too big with respect to the total agEUR in circulation
  maxBorrowable: parseAmount.ether('300000'),
  // Free flash loans for agEUR
  flashLoanFee: parseAmount.gwei('0'),
};

const func: DeployFunction = async ({ deployments, ethers, network }) => {
  const { deployer } = await ethers.getNamedSigners();
  const json = await import('./networks/' + network.name + '.json');
  const governor = json.governor;
  let proxyAdminAddress: string;
  let agTokenAddress: string;
  let proxyAdmin: ProxyAdmin;
  let treasuryContract: Treasury;
  let signer: SignerWithAddress;
  let coreBorrow: CoreBorrow;
  let flashAngle: FlashAngle;

  const stableName = 'EUR';

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
    agTokenAddress = (await deployments.get(`AgToken_${stableName}`)).address;
  }
  proxyAdmin = new ethers.Contract(proxyAdminAddress, ProxyAdmin__factory.createInterface(), signer) as ProxyAdmin;
  const treasury = await deployments.get('Treasury');
  treasuryContract = new ethers.Contract(treasury.address, Treasury__factory.createInterface(), signer) as Treasury;

  const coreBorrowAddress = await deployments.get('CoreBorrow');

  coreBorrow = new ethers.Contract(
    coreBorrowAddress.address,
    CoreBorrow__factory.createInterface(),
    signer,
  ) as CoreBorrow;

  console.log('Setting up the flash loan module parameter');

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
    await flashAngle.setFlashLoanParameters(agTokenAddress, flashLoanParams.flashLoanFee, flashLoanParams.maxBorrowable)
  ).wait();
  console.log('Success');
  console.log('');
};

func.tags = ['flashAngleGovernance'];
func.dependencies = ['flashAngle'];
export default func;
