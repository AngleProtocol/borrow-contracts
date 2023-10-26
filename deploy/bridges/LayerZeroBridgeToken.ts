import { parseEther } from 'ethers/lib/utils';
import { DeployFunction } from 'hardhat-deploy/types';
import yargs from 'yargs';

import { LayerZeroBridgeToken__factory } from '../../typechain';
import LZ_ENDPOINTS from '../constants/layerzeroEndpoints.json';
import { deployImplem, deployProxy } from '../helpers';
const argv = yargs.env('').boolean('ci').parseSync();

const stable = 'EUR';

const func: DeployFunction = async ({ ethers, network, deployments }) => {
  const { deployer } = await ethers.getNamedSigners();

  const endpointAddr = (LZ_ENDPOINTS as { [name: string]: string })[network.name];
  console.log(`[${network.name}] LayerZero Endpoint address: ${endpointAddr}`);
  const deploymentName = 'LayerZeroBridgeToken_V1_0_Implementation';
  const name = 'LayerZeroBridgeToken';
  const { deploy } = deployments;

  await deploy(deploymentName, {
    contract: name,
    from: deployer.address,
    log: !argv.ci,
  });
  const implementationAddress = (await ethers.getContract(deploymentName)).address;

  console.log(`Successfully deployed ${deploymentName} at ${implementationAddress}`);

  const treasury = await ethers.getContract('Treasury_EUR');
  const proxyAdmin = await ethers.getContract('ProxyAdmin');
  console.log(`LayerZero Bridge ag${stable}`, `LZ-ag${stable}`, endpointAddr, treasury.address, parseEther('0'));

  await deployProxy(
    `LayerZeroBridge_${stable}`,
    implementationAddress,
    proxyAdmin.address,
    LayerZeroBridgeToken__factory.createInterface().encodeFunctionData('initialize', [
      `LayerZero Bridge ag${stable}`,
      `LZ-ag${stable}`,
      endpointAddr,
      treasury.address,
      parseEther('0'),
    ]),
  );

  /* The following things need to be done after this deployment:
  - setTrustedRemote on the LayerZeroBridgeToken -> for all the supported bridge tokens. Use LayerZeroSetSources for this
  - addBridgeToken in the canonical agEUR -> limit should be higher than the limit which has already been minted in the contract
  - setChainTotalHourlyLimit in the canonical agEUR
  - setUseCustomAdapterParams in the lz-agEUR contract
  */
};

func.tags = ['LayerZeroBridgeToken'];
export default func;
