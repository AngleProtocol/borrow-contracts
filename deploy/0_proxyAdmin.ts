// To be used in other chains than mainnet to deploy proxy admin for our upgradeable contracts
import { ChainId, CONTRACTS_ADDRESSES } from '@angleprotocol/sdk';
import { DeployFunction } from 'hardhat-deploy/types';
import yargs from 'yargs';

import { ProxyAdmin, ProxyAdmin__factory } from '../typechain';
const argv = yargs.env('').boolean('ci').parseSync();

const func: DeployFunction = async ({ deployments, ethers, network }) => {
  const { deploy } = deployments;
  const { deployer } = await ethers.getNamedSigners();
  let proxyAdmin: ProxyAdmin;
  let guardian: string;

  if (!network.live) {
    // If we're in mainnet fork, we're using the `ProxyAdmin` address from mainnet
    guardian = CONTRACTS_ADDRESSES[ChainId.MAINNET]?.Guardian!;
  } else {
    // Otherwise, we're using the proxy admin address from the desired network
    guardian = CONTRACTS_ADDRESSES[network.config.chainId as ChainId]?.Guardian!;
  }

  console.log(`Now deploying ProxyAdmin on the chain ${network.config.chainId}`);
  console.log('Guardian address is ', guardian);
  await deploy('ProxyAdmin', {
    contract: 'ProxyAdmin',
    from: deployer.address,
    log: !argv.ci,
  });
  const proxyAdminAddress = (await ethers.getContract('ProxyAdmin')).address;

  proxyAdmin = new ethers.Contract(proxyAdminAddress, ProxyAdmin__factory.createInterface(), deployer) as ProxyAdmin;

  console.log(`Transferring ownership of the proxy admin to the guardian ${guardian}`);
  await (await proxyAdmin.connect(deployer).transferOwnership(guardian)).wait();
  console.log('Success');
};

func.tags = ['proxyAdmin'];
export default func;
