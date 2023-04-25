import { parseEther } from 'ethers/lib/utils';
import { ethers } from 'hardhat';

import { AgToken, AgToken__factory, Treasury, Treasury__factory } from '../../typechain';

async function main() {
  let agToken: AgToken;
  const { deployer } = await ethers.getNamedSigners();
  agToken = new ethers.Contract(
    '0x31429d1856aD1377A8A0079410B297e1a9e214c2',
    AgToken__factory.createInterface(),
    deployer,
  ) as AgToken;
  console.log('Sending tx');
  await (await agToken.connect(deployer).transfer(deployer.address, parseEther('1'), { nonce: 1022 })).wait();
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
