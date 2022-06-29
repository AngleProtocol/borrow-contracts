import { deployments, ethers } from 'hardhat';
import yargs from 'yargs';

const argv = yargs.env('').boolean('ci').parseSync();

export const deploy = async (name: string, args: any[], isMock = false): Promise<string> => {
  const { deploy } = deployments;
  const { deployer } = await ethers.getNamedSigners();

  console.log(`Now deploying ${isMock && 'a mock '}${name}`);
  const deploymentName = `${isMock ? 'Mock_' : ''}${name}`;
  await deploy(deploymentName, {
    contract: name,
    from: deployer.address,
    log: !argv.ci,
    args: args,
  });
  const address = (await ethers.getContract(deploymentName)).address;
  console.log(`Successfully deployed the implementation for ${deploymentName} at ${address}`);

  return address;
};

export const deployImplem = async (name: string, isMock = false): Promise<string> => {
  const { deploy } = deployments;
  const { deployer } = await ethers.getNamedSigners();

  console.log(`Now deploying ${isMock && 'a mock '}${name} implementation`);
  let implementationAddress;

  const deploymentName = `${isMock ? 'Mock_' : ''}${name}_Implementation`;
  try {
    implementationAddress = (await ethers.getContract(deploymentName)).address;
    console.log(`${deploymentName} has already been deployed at ${implementationAddress}`);
  } catch {
    await deploy(deploymentName, {
      contract: name,
      from: deployer.address,
      log: !argv.ci,
    });
    implementationAddress = (await ethers.getContract(deploymentName)).address;
    console.log(`Successfully deployed ${deploymentName} at ${implementationAddress}`);
  }
  return implementationAddress;
};

export const deployProxy = async (
  name: string,
  implementation: string,
  admin: string,
  data: string,
  isMock = false,
): Promise<string> => {
  const { deploy } = deployments;
  const { deployer } = await ethers.getNamedSigners();

  console.log(`Now deploying ${isMock && 'a mock '}${name}`);
  const deploymentName = `${isMock ? 'Mock_' : ''}${name}`;
  await deploy(deploymentName, {
    contract: 'TransparentUpgradeableProxy',
    from: deployer.address,
    log: !argv.ci,
    args: [implementation, admin, data],
  });
  const address = (await ethers.getContract(deploymentName)).address;
  console.log(`Successfully deployed the implementation for ${deploymentName} at ${address}`);

  return address;
};
