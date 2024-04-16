import { ethers} from 'hardhat';

import { parseEther } from 'ethers/lib/utils';

async function main() {
  const { deployer } = await ethers.getNamedSigners();

  await deployer.sendTransaction({
    to: '0xfdA462548Ce04282f4B6D6619823a7C64Fdc0185',
    value: parseEther('9.99')
  })

}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
