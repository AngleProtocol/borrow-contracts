import { DeployFunction } from 'hardhat-deploy/types';

const func: DeployFunction = async ({ deployments, ethers, network }) => {
  const { deploy } = deployments;
  const { deployer } = await ethers.getNamedSigners();

  console.log('Now deploying Multicall with failure');
  const multicallWithFailure = await deploy('MultiCallWithFailure', {
    contract: 'MultiCallWithFailure',
    from: deployer.address,
  });

  console.log(`Successfully deployed MulticallWithFailure at the address ${multicallWithFailure.address}\n`);
  console.log(`yarn hardhat verify --network ${network.name} ${multicallWithFailure.address}`);
};

func.tags = ['multicall_with_failure'];
export default func;
