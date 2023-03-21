import { parseEther } from 'ethers/lib/utils';
import { ethers } from 'hardhat';

import { OldAgEUR, OldAgEUR__factory, Treasury, Treasury__factory } from '../../typechain';

async function main() {
  let agToken: OldAgEUR;
  let treasury: Treasury;
  const { deployer } = await ethers.getNamedSigners();
  agToken = new ethers.Contract(
    '0xFE0E499fBb529214ce9744a66FCE8B05413aBB18',
    OldAgEUR__factory.createInterface(),
    deployer,
  ) as OldAgEUR;
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
