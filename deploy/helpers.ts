import { resolveEtherscanApiKey } from '@nomiclabs/hardhat-etherscan/dist/src/resolveEtherscanApiKey';
import { config, deployments, ethers, run } from 'hardhat';
import { request } from 'undici';
import yargs from 'yargs';
const argv = yargs.env('').boolean('ci').parseSync();

export const deploy = async (name: string, args: any[], isMock = false, verify = true): Promise<string> => {
  const { deploy } = deployments;
  const { deployer } = await ethers.getNamedSigners();
  const deploymentName = `${isMock ? 'Mock_' : ''}${name}`;
  let address;

  try {
    address = (await ethers.getContract(deploymentName)).address;
    console.log(`Reusing ${deploymentName} at ${address}`);
  } catch {
    console.log(`Now deploying ${isMock ? 'a mock ' : ' '}${name}`);
    await deploy(deploymentName, {
      contract: name,
      from: deployer.address,
      log: !argv.ci,
      args: args,
    });
    address = (await ethers.getContract(deploymentName)).address;
    if (verify) {
      try {
        await (run as any)(
          'verify:verify',
          {
            address: address,
            constructorArguments: args,
          },
          { config: { noCompile: true } },
        );
      } catch (e) {
        console.log('Verification failed');
      }
    }

    console.log(`Successfully deployed ${deploymentName} at ${address}`);
  }

  return address;
};

export const deployImplem = async (name: string, isMock = false, verify = true): Promise<string> => {
  const { deploy } = deployments;
  const { deployer } = await ethers.getNamedSigners();

  console.log(`Now deploying ${isMock ? 'a mock ' : ' '}${name} implementation`);
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
    if (verify) {
      try {
        await (run as any)(
          'verify:verify',
          {
            address: implementationAddress,
            constructorArguments: [],
            noCompile: true,
          },
          { config: { noCompile: true } },
        );
      } catch (e) {
        console.log('Verification failed');
      }
    }

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
  verify = true,
): Promise<string> => {
  const { deploy } = deployments;
  const { deployer } = await ethers.getNamedSigners();
  const deploymentName = `${isMock ? 'Mock_' : ''}${name}`;
  let address;

  try {
    address = (await ethers.getContract(deploymentName)).address;
    console.log(`Reusing ${deploymentName} at ${address}`);
  } catch {
    console.log(`Now deploying ${isMock ? 'a mock ' : ' '}${name}`);
    await deploy(deploymentName, {
      contract: 'TransparentUpgradeableProxy',
      from: deployer.address,
      log: !argv.ci,
      args: [implementation, admin, data],
    });
    address = (await ethers.getContract(deploymentName)).address;
    if (verify) {
      try {
        await (run as any)(
          'verify:verify',
          {
            address: address,
            constructorArguments: [implementation, admin, data],
            noCompile: true,
          },
          { config: { noCompile: true } },
        );
      } catch (e) {
        console.log('Verification failed');
      }
      /*
      try {
        linkProxyWithImplementationAbi(address, implementation, []);
      } catch (e) {
        console.log('Verification failed');
      }
      */
    }
    console.log(`Successfully deployed the implementation for ${deploymentName} at ${address}`);
  }
  return address;
};

// To programmatically verify proxy
async function linkProxyWithImplementationAbi(proxyAddress: string, implAddress: string, errors: string[]) {
  const endpoints = await run('verify:get-etherscan-endpoint');
  const etherscanConfig = (config as any).etherscan;
  const key = resolveEtherscanApiKey(etherscanConfig, endpoints.network);
  const etherscanApi = { key, endpoints };

  const params = {
    module: 'contract',
    action: 'verifyproxycontract',
    address: proxyAddress,
    expectedimplementation: implAddress,
  };
  const parameters = new URLSearchParams({ ...params, apikey: etherscanApi.key });

  const response = await request(etherscanApi.endpoints.urls.apiURL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: parameters.toString(),
  });

  if (!(response.statusCode >= 200 && response.statusCode <= 299)) {
    const responseBodyText = await response.body.text();
    throw new Error(`Etherscan API call failed with status ${response.statusCode}, response: ${responseBodyText}`);
  }

  const responseBodyJson = await response.body.json();
  console.debug('Etherscan response', JSON.stringify(responseBodyJson));
}
