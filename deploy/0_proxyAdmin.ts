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
  let governor: string;

  if (!network.live) {
    // If we're in mainnet fork, we're using the `ProxyAdmin` address from mainnet
    guardian = CONTRACTS_ADDRESSES[ChainId.MAINNET]?.Guardian!;
    governor = CONTRACTS_ADDRESSES[ChainId.MAINNET]?.Governor!;
  } else {
    // Otherwise, we're using the proxy admin address from the desired network
    guardian = CONTRACTS_ADDRESSES[network.config.chainId as ChainId]?.Guardian!;
    guardian = '0xf0A31faec2B4fC6396c65B1aF1F6A71E653f11F0';
    governor = '0x0F70EeD1Bb51d5eDB1a2E46142638df959bAFD69';
  }
  /*
  console.log(`Now deploying ProxyAdmin on the chain ${network.config.chainId}`);
  console.log('Governor address is ', governor);
  await deploy('ProxyAdmin', {
    contract: 'ProxyAdmin',
    from: deployer.address,
    log: !argv.ci,
  });
  */
  const proxyAdminAddress = (await ethers.getContract('ProxyAdmin')).address;

  proxyAdmin = new ethers.Contract(proxyAdminAddress, ProxyAdmin__factory.createInterface(), deployer) as ProxyAdmin;

  console.log(`Transferring ownership of the proxy admin to the governor ${governor}`);
  await (await proxyAdmin.connect(deployer).transferOwnership(governor)).wait();
  console.log('Success');
};

func.tags = ['proxyAdmin'];
export default func;
