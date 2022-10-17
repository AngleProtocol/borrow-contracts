import { BigNumber, Contract } from 'ethers';
import { parseEther } from 'ethers/lib/utils';
import { DeployFunction } from 'hardhat-deploy/types';

import { ZERO_ADDRESS } from '../../test/hardhat/utils/helpers';
import {
  AgTokenSideChainMultiBridge,
  AgTokenSideChainMultiBridge__factory,
  LayerZeroBridge__factory,
  MockTreasury,
  MockTreasury__factory,
} from '../../typechain';
import LZ_ENDPOINTS from '../constants/layerzeroEndpoints.json';
import { deploy, deployImplem, deployProxy } from '../helpers';

const func: DeployFunction = async ({ ethers, network }) => {
  /*
  // Using an EOA as proxyAdmin as it's a mock deployment
  const { deployer, proxyAdmin } = await ethers.getNamedSigners();

  const treasury = await deploy(
    'MockTreasury',
    [proxyAdmin.address, deployer.address, deployer.address, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS],
    true,
  );
  const canonicalTokenImplem = await deployImplem('AgTokenSideChainMultiBridge', true);

  const treasuryContract = new Contract(treasury, MockTreasury__factory.abi, deployer) as MockTreasury;
  try {
    (await ethers.getContract('Mock_AgTokenSideChainMultiBridge')).address;
  } catch {
    const futureAddress = ethers.utils.getContractAddress({
      from: deployer.address,
      nonce: (await deployer.getTransactionCount()) + 1,
    });
    await (await treasuryContract.setStablecoin(futureAddress)).wait();
  }

  const canonicalToken = await deployProxy(
    'AgTokenSideChainMultiBridge',
    canonicalTokenImplem,
    proxyAdmin.address,
    AgTokenSideChainMultiBridge__factory.createInterface().encodeFunctionData('initialize', [
      'AgEUR_TEST',
      'AgEUR_TEST',
      treasury,
    ]),
    true,
  );

  const endpointAddr = (LZ_ENDPOINTS as { [name: string]: string })[network.name];
  console.log(`[${network.name}] LayerZero Endpoint address: ${endpointAddr}`);
  const layerZeroBridgeImplem = await deployImplem('LayerZeroBridge', true);

  const layerZeroBridge = await deployProxy(
    'LayerZeroBridge',
    layerZeroBridgeImplem,
    proxyAdmin.address,
    LayerZeroBridge__factory.createInterface().encodeFunctionData('initialize', [
      'LayerZero Bridge agEUR',
      endpointAddr,
      treasury,
    ]),
    true,
  );

  console.log('Adding LayerZero Bridge');
  const canonicalTokenContract = new Contract(
    canonicalToken,
    AgTokenSideChainMultiBridge__factory.abi,
    deployer,
  ) as AgTokenSideChainMultiBridge;
  await (
    await canonicalTokenContract.addBridgeToken(
      layerZeroBridge,
      parseEther('1000000'),
      parseEther('100000'),
      BigNumber.from(1e7),
      false,
    )
  ).wait();
  */
};

func.tags = ['mockLayerZeroBridge'];
export default func;
