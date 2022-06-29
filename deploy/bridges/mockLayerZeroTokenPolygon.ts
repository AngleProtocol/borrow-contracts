import { BigNumber, Contract } from 'ethers';
import { parseEther } from 'ethers/lib/utils';
import { DeployFunction } from 'hardhat-deploy/types';

import { ZERO_ADDRESS } from '../../test/utils/helpers';
import { AgTokenSideChainMultiBridge, AgTokenSideChainMultiBridge__factory } from '../../typechain';
import LZ_ENDPOINTS from '../constants/layerzeroEndpoints.json';
import { deploy, deployImplem, deployProxy } from '../helpers';

const func: DeployFunction = async ({ ethers, network }) => {
  // Using an EOA as proxyAdmin as it's a mock deployment
  const { deployer, proxyAdmin } = await ethers.getNamedSigners();

  const canonicalTokenImplem = await deployImplem('AgTokenSideChainMultiBridge', true);
  const canonicalToken = await deployProxy(
    'AgTokenSideChainMultiBridge',
    canonicalTokenImplem,
    proxyAdmin.address,
    '0x',
    true,
  );

  const treasury = await deploy(
    'MockTreasury',
    [proxyAdmin, deployer.address, deployer.address, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS],
    true,
  );

  console.log('Initializing the proxy');
  const contract = new Contract(
    canonicalToken,
    AgTokenSideChainMultiBridge__factory.abi,
    deployer,
  ) as AgTokenSideChainMultiBridge;
  await (await contract.initialize('AgEUR_TEST', 'AgEUR_TEST', treasury)).wait();

  const endpointAddr = (LZ_ENDPOINTS as { [name: string]: string })[network.name];
  console.log(`[${network.name}] LayerZero Endpoint address: ${endpointAddr}`);
  const angleOFT = await deploy(
    'AngleOFT',
    ['AgEUR_LayerZero_TEST', 'AgEUR_LayerZero_TEST', endpointAddr, canonicalToken, deployer.address],
    true,
  );

  console.log('Adding LayerZero Bridge Token');
  await (
    await contract.addBridgeToken(angleOFT, parseEther('1000000'), parseEther('100000'), BigNumber.from(1e7), false)
  ).wait();
};

func.tags = ['mockLayerZeroPolygon'];
export default func;
