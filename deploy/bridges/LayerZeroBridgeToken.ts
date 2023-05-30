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

  /*
  const treasury = await ethers.getContract('Treasury_EUR');
  const proxyAdmin = await ethers.getContract('ProxyAdmin');
  await deployProxy(
    `LayerZeroBridge_${stable}`,
    layerZeroBridgeImplem,
    proxyAdmin.address,
    LayerZeroBridgeToken__factory.createInterface().encodeFunctionData('initialize', [
      `LayerZero Bridge ag${stable}`,
      `LZ-ag${stable}`,
      endpointAddr,
      treasury.address,
      parseEther('0'),
    ]),
  );
  */

  /* The following things need to be done after this deployment:
  - setSources on the LayerZeroBridgeToken
  - addBridgeToken in the canonical agEUR -> limit should be higher than the limit which has already been minted in the contract
  - setChainTotalHourlyLimit in the canonical agEUR
  - setUseCustomAdapterParams
  - And depending on the value of the EXTRA_GAS constant: setMinDstGasLookup to all the chains
  */
};

func.tags = ['LayerZeroBridgeToken'];
export default func;
