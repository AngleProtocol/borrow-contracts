import yargs from 'yargs';
import { DeployFunction } from 'hardhat-deploy/types';
import { ChainId, CONTRACTS_ADDRESSES } from '@angleprotocol/sdk';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import {
  AgTokenIntermediateUpgrade,
  AgTokenIntermediateUpgrade__factory,
  ProxyAdmin,
  ProxyAdmin__factory,
} from '../typechain';
import { parseEther } from 'ethers/lib/utils';
import hre from 'hardhat';
const argv = yargs.env('').boolean('ci').parseSync();

const func: DeployFunction = async ({ deployments, ethers, network }) => {
  // Deployment script for agToken upgrade
  const { deploy } = deployments;
  const { deployer } = await ethers.getNamedSigners();

  let implementationName: string;
  let proxyAdmin: ProxyAdmin;
  let agToken: AgTokenIntermediateUpgrade;
  let signer: SignerWithAddress;

  implementationName = 'AgTokenIntermediateUpgrade';

  console.log('Now deploying the implementation for the upgraded AgToken');
  await deploy(`${implementationName}_Implementation`, {
    contract: implementationName,
    from: deployer.address,
    log: !argv.ci,
  });
  const agTokenImplementation = (await ethers.getContract(`${implementationName}_Implementation`)).address;

  console.log(`Successfully deployed the implementation for AgTokenUpgrade at ${agTokenImplementation}`);
  console.log('');

  // ------------------------------------------------------------------------------
  // ------------------------------ MAINNET FORK ----------------------------------
  // ------------------------------------------------------------------------------

  if (!network.live) {
    const governor = '0xdc4e6dfe07efca50a197df15d9200883ef4eb1c8';
    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [governor],
    });
    await hre.network.provider.send('hardhat_setBalance', [governor, '0x10000000000000000000000000000']);
    signer = await ethers.getSigner(governor);

    const proxyAdminAddress = CONTRACTS_ADDRESSES[ChainId.MAINNET].ProxyAdmin!;
    const agTokenAddress = CONTRACTS_ADDRESSES[ChainId.MAINNET].agEUR?.AgToken!;
    proxyAdmin = new ethers.Contract(proxyAdminAddress, ProxyAdmin__factory.createInterface(), signer) as ProxyAdmin;

    // We're just upgrading the agToken in mainnet fork
    console.log('Upgrading AgToken');
    await (await proxyAdmin.connect(signer).upgrade(agTokenAddress, agTokenImplementation)).wait();
    console.log('Success');
    console.log('');
    agToken = new ethers.Contract(
      agTokenAddress,
      AgTokenIntermediateUpgrade__factory.createInterface(),
      signer,
    ) as AgTokenIntermediateUpgrade;

    console.log('Setting up the minter role on the agToken');
    await (await agToken.connect(signer).setUpMinter()).wait();
    console.log('Success');
    console.log('');
    console.log('Now minting agToken');
    await (await agToken.connect(signer).mint(governor, parseEther('1000000'))).wait();
    console.log('Success');
  }
};

func.tags = ['agTokenUpgrade'];
export default func;
