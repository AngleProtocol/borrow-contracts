// To be used in other chains than mainnet to deploy proxy admin for our upgradeable contracts
import { DeployFunction } from 'hardhat-deploy/types';
import yargs from 'yargs';

import { ProxyAdmin, ProxyAdmin__factory } from '../../typechain';
const argv = yargs.env('').boolean('ci').parseSync();

const func: DeployFunction = async ({ deployments, ethers, network }) => {
  const { deploy } = deployments;
  const { deployer } = await ethers.getNamedSigners();
  let proxyAdmin: ProxyAdmin;
  const json = await import('../networks/' + network.name + '.json');
  const admin = json.angleLabs;
  const name = 'ProxyAdminAngleLabs';

  console.log(`Now deploying ${name} on the chain ${network.config.chainId}`);
  console.log('Admin address is ', admin);
  console.log(deployer.address)

  await deploy(name, {
    contract: 'ProxyAdmin',
    from: deployer.address,
    log: !argv.ci,
  });

  const proxyAdminAddress = (await ethers.getContract(name)).address;

  proxyAdmin = new ethers.Contract(proxyAdminAddress, ProxyAdmin__factory.createInterface(), deployer) as ProxyAdmin;

  console.log(`Transferring ownership of the proxy admin to the admin ${admin}`);
  await (await proxyAdmin.connect(deployer).transferOwnership(admin)).wait();
  console.log('Success');
};

// func.tags = ['proxyAdminAngleLabs'];
export default func;
