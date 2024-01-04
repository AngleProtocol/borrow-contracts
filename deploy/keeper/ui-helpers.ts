import { ChainId, CONTRACTS_ADDRESSES } from '@angleprotocol/sdk';
import { DeployFunction } from 'hardhat-deploy/types';

import { AngleHelpers__factory } from '../../typechain';

const func: DeployFunction = async ({ deployments, ethers, network }) => {
  const { deploy } = deployments;
  const { deployer } = await ethers.getNamedSigners();
  let proxyAdmin: string;

  if (!network.live) {
    // If we're in mainnet fork, we're using the `ProxyAdmin` address from mainnet
    proxyAdmin = CONTRACTS_ADDRESSES[ChainId.MAINNET].ProxyAdmin!;
  } else {
    // Otherwise, we're using the proxy admin address from the desired network
    proxyAdmin = CONTRACTS_ADDRESSES[network.config.chainId as ChainId].ProxyAdmin!;
  }
  // Using the proxyAdminGuardian for Avalanche
  proxyAdmin = '0xe14bFA5575d9906BA35beb15C9DBe5C77bFdd5b5';
  console.log('deployer ', deployer.address);

  console.log('Now deploying the AngleHelpers contract');
  console.log('Starting with the implementation');
  const angleHelpersImplementation = await deploy('AngleHelpers_Avalanche_Implementation', {
    contract: 'AngleBorrowHelpers',
    from: deployer.address,
  });

  console.log(
    `Successfully deployed the Avalanche implementation for AngleBorrowHelpers at ${angleHelpersImplementation.address}\n`,
  );

  console.log('Now deploying the Proxy');
  console.log(`Proxy admin: ${proxyAdmin}`);
  const angleHelpers = await deploy('AngleBorrowHelpersAvalanche', {
    contract: 'TransparentUpgradeableProxy',
    from: deployer.address,
    args: [angleHelpersImplementation.address, proxyAdmin, '0x'],
  });

  console.log(`Successfully deployed AngleHelpers at the address ${angleHelpers.address}\n`);
};

func.tags = ['angleHelpers'];
export default func;
