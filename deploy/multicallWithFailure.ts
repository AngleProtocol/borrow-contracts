import { DeployFunction } from 'hardhat-deploy/types';

const func: DeployFunction = async ({ deployments, ethers }) => {
  const { deploy } = deployments;
  const { deployer } = await ethers.getNamedSigners();

  console.log('Now deploying KeeperMulticall');
  console.log('Starting with the implementation');
  const multicallWithFailure = await deploy('MultiCallWithFailure', {
    contract: 'MultiCallWithFailure',
    from: deployer.address,
  });

  console.log(`Successfully deployed MulticallWithFailure at the address ${multicallWithFailure.address}\n`);
};

func.tags = ['multicall_with_failure'];
export default func;
