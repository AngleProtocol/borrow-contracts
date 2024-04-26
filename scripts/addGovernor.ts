import { ChainId, registry } from '@angleprotocol/sdk';
import { deployments, ethers, network } from 'hardhat';

import { CoreBorrow, CoreBorrow__factory } from '../typechain';

async function main() {
  const { deployer } = await ethers.getNamedSigners();
  const coreBorrowAddress = (await deployments.get('CoreBorrowTest')).address
  const newGovernor = registry(network.config.chainId as ChainId)?.Governor!

  const coreBorrow = new ethers.Contract(coreBorrowAddress, CoreBorrow__factory.createInterface(), deployer) as CoreBorrow;
  console.log("Adding governor")
  console.log(newGovernor,coreBorrowAddress);
  await coreBorrow.connect(deployer).addGovernor(newGovernor)
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
