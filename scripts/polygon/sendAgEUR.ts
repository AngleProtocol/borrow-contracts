import { ethers } from 'hardhat';
import { Treasury, Treasury__factory, AgToken, AgToken__factory } from '../../typechain';
import { parseEther } from 'ethers/lib/utils';

async function main() {
  let agToken: AgToken;
  let treasury: Treasury;
  const { deployer } = await ethers.getNamedSigners();
  agToken = new ethers.Contract(
    '0xFE0E499fBb529214ce9744a66FCE8B05413aBB18',
    AgToken__factory.createInterface(),
    deployer,
  ) as AgToken;
  treasury = new ethers.Contract(
    '0xdE725566Fa2bAfd175066943D8D50ae762058e92',
    Treasury__factory.createInterface(),
    deployer,
  ) as Treasury;

  console.log('Adding minter');
  await (await treasury.connect(deployer).addMinter(deployer.address)).wait();
  console.log('Now minting');
  console.log(await treasury.stablecoin());

  await (await agToken.connect(deployer).mint(deployer.address, parseEther('1000'))).wait();
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
