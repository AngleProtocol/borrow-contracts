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
  const json = await import('./networks/' + network.name + '.json');
  let governor = json.governor;
  const guardian = json.guardian;
  let name = 'ProxyAdmin';

  console.log(governor, guardian);

  // TODO update if ProxyAdminGuardian
  governor = guardian;
  name = 'ProxyAdminGuardian';

  console.log(`Now deploying ${name} on the chain ${network.config.chainId}`);
  console.log('Governor address is ', governor);

  await deploy(name, {
    contract: 'ProxyAdmin',
    from: deployer.address,
    log: !argv.ci,
  });

  const proxyAdminAddress = (await ethers.getContract(name)).address;

  proxyAdmin = new ethers.Contract(proxyAdminAddress, ProxyAdmin__factory.createInterface(), deployer) as ProxyAdmin;

  console.log(`Transferring ownership of the proxy admin to the governor ${governor}`);
  await (await proxyAdmin.connect(deployer).transferOwnership(governor)).wait();
  console.log('Success');
};

func.tags = ['proxyAdmin'];
export default func;
