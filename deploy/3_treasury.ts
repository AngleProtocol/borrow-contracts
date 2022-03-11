import { ChainId, CONTRACTS_ADDRESSES } from '@angleprotocol/sdk';
import { DeployFunction } from 'hardhat-deploy/types';
import yargs from 'yargs';
import { AgTokenSideChain, AgTokenSideChain__factory } from '../typechain';

import { Treasury__factory } from '../typechain';
const argv = yargs.env('').boolean('ci').parseSync();

const func: DeployFunction = async ({ deployments, ethers, network }) => {
  const { deploy } = deployments;
  const { deployer } = await ethers.getNamedSigners();
  let proxyAdmin: string;
  let agTokenAddress: string;
  let agTokenName: string = 'agEUR';

  if (!network.live || network.config.chainId == 1) {
    // If we're in mainnet fork, we're using the `ProxyAdmin` address from mainnet
    proxyAdmin = CONTRACTS_ADDRESSES[ChainId.MAINNET].ProxyAdmin!;
    agTokenAddress = CONTRACTS_ADDRESSES[ChainId.MAINNET].agEUR?.AgToken!;
  } else {
    // Otherwise, we're using the proxy admin address from the desired network and the newly deployed agToken
    proxyAdmin = CONTRACTS_ADDRESSES[network.config.chainId as ChainId].ProxyAdmin!;
    agTokenAddress = (await deployments.get('AgToken')).address;
  }

  console.log('Now deploying Treasury');
  console.log('Starting with the implementation');
  await deploy('Treasury_Implementation', {
    contract: 'Treasury',
    from: deployer.address,
    log: !argv.ci,
  });
  const treasuryImplementation = (await ethers.getContract('Treasury_Implementation')).address;

  console.log(`Successfully deployed the implementation for Treasury at ${treasuryImplementation}`);
  console.log('');

  const treasuryInterface = Treasury__factory.createInterface();

  const coreBorrow = await deployments.get('CoreBorrow');

  const dataTreasury = new ethers.Contract(
    treasuryImplementation,
    treasuryInterface,
  ).interface.encodeFunctionData('initialize', [coreBorrow.address, agTokenAddress]);

  console.log('Now deploying the Proxy');
  await deploy('Treasury', {
    contract: 'TransparentUpgradeableProxy',
    from: deployer.address,
    args: [treasuryImplementation, proxyAdmin, dataTreasury],
    log: !argv.ci,
  });

  const treasury = (await deployments.get('Treasury')).address;
  console.log(`Successfully deployed Treasury at the address ${treasury}`);
  console.log('');
  if (network.config.chainId != 1 && network.live) {
    console.log(
      "Because we're in a specific network (not mainnet or mainnet fork) and now that treasury is ready, initializing the agToken contract",
    );
    const agToken = new ethers.Contract(
      agTokenAddress,
      AgTokenSideChain__factory.createInterface(),
      deployer,
    ) as AgTokenSideChain;
    await (await agToken.connect(deployer).initialize(agTokenName, agTokenName, treasury)).wait();
    console.log('Success: agToken successfully initialized');
  }
};

func.tags = ['treasury'];
func.dependencies = ['agTokenImplementation'];
export default func;
