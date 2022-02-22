import yargs from 'yargs';
import { DeployFunction } from 'hardhat-deploy/types';
import { Signer } from 'ethers';
import hre, { contract, ethers, web3 } from 'hardhat';

import { CONTRACTS_ADDRESSES, ChainId } from '@angleprotocol/sdk';
import { AgToken, ProxyAdmin, ProxyAdmin__factory, AgToken__factory, CoreBorrow } from '../typechain';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
const argv = yargs.env('').boolean('ci').parseSync();

const func: DeployFunction = async ({ deployments, ethers, network }) => {
  const { deploy } = deployments;
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
  await (await proxyAdmin.connect(signer).upgrade(agTokenAddress, agTokenImplementation.address)).wait();
  agToken = new ethers.Contract(agTokenAddress, AgToken__factory.createInterface(), deployer) as AgToken;
  coreBorrow = (await ethers.getContract('CoreBorrow')) as CoreBorrow;

  await agToken.connect(signer).setUpTreasury(treasury.address);
  await coreBorrow.connect(signer).addFlashLoanerTreasuryRole(treasury.address);
};

func.tags = ['governanceTx'];
func.dependencies = ['agTokenImplementation'];
export default func;
