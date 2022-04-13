import { ChainId, CONTRACTS_ADDRESSES } from '@angleprotocol/sdk';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import hre from 'hardhat';
import { DeployFunction } from 'hardhat-deploy/types';
import yargs from 'yargs';

import { ProxyAdmin, ProxyAdmin__factory } from '../typechain';
const argv = yargs.env('').boolean('ci').parseSync();

const func: DeployFunction = async ({ deployments, ethers, network }) => {
  const { deployer } = await ethers.getNamedSigners();
  const { deploy } = deployments;
  const json = await import('./networks/' + network.name + '.json');
  const governor = json.governor;
  let routerAddress: string;
  let signer: SignerWithAddress;
  let proxyAdmin: ProxyAdmin;

  console.log('Now deploying the implementation for the upgraded router contract');
  await deploy(`AngleRouter_NewImplementation`, {
    contract: 'AngleRouter',
    from: deployer.address,
    log: !argv.ci,
  });
  const routerImplementation = (await ethers.getContract('AngleRouter_NewImplementation')).address;
  console.log('');

  if (!network.live) {
    // If we're in mainnet fork, we're using the `ProxyAdmin` address from mainnet
    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [governor],
    });
    await hre.network.provider.send('hardhat_setBalance', [governor, '0x10000000000000000000000000000']);
    signer = await ethers.getSigner(governor);
    routerAddress = CONTRACTS_ADDRESSES[ChainId.MAINNET].AngleRouter!;

    const proxyAdminAddress = CONTRACTS_ADDRESSES[ChainId.MAINNET].ProxyAdmin!;
    proxyAdmin = new ethers.Contract(proxyAdminAddress, ProxyAdmin__factory.createInterface(), signer) as ProxyAdmin;
    // We're just upgrading the router in mainnet fork
    console.log('Upgrading the router contract');
    console.log(routerAddress, routerImplementation);
    await (await proxyAdmin.connect(signer).upgrade(routerAddress, routerImplementation)).wait();
    console.log('Success');
  }
};

func.tags = ['router'];
func.dependencies = ['unpausing'];
export default func;
