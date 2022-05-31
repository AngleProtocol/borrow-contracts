// To be used in other chains than mainnet to deploy proxy admin for our upgradeable contracts
import { DeployFunction } from 'hardhat-deploy/types';
import yargs from 'yargs';

import { ProxyAdmin, ProxyAdmin__factory } from '../typechain';
const argv = yargs.env('').boolean('ci').parseSync();

const func: DeployFunction = async ({ deployments, ethers, network }) => {
  const { deploy } = deployments;
  const { deployer } = await ethers.getNamedSigners();
  const json = await import('./networks/' + network.name + '.json');
  const governor = json.governor;
  let proxyAdmin: ProxyAdmin;

  console.log(`Now deploying ProxyAdmin on the chain ${network.config.chainId}`);
  await deploy('ProxyAdmin', {
    contract: 'ProxyAdmin',
    from: deployer.address,
    log: !argv.ci,
  });
  const proxyAdminAddress = (await ethers.getContract('ProxyAdmin')).address;

  proxyAdmin = new ethers.Contract(proxyAdminAddress, ProxyAdmin__factory.createInterface(), deployer) as ProxyAdmin;

  console.log(`Transferring ownership of the proxy admin to the governor ${governor}`);
  await (await proxyAdmin.connect(deployer).transferOwnership(governor)).wait();
  console.log('Success');
};

func.tags = ['proxyAdmin'];
export default func;
