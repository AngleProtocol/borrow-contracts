import { ChainId } from '@angleprotocol/sdk';
import { Contract } from 'ethers';
import { ethers } from 'hardhat';

import { AngleOFT, AngleOFT__factory } from '../../typechain';

async function main() {
  const { deployer } = await ethers.getNamedSigners();

  const angleOFT = (await ethers.getContract('Mock_AngleOFT')).address;
  const contractAngleOFT = new Contract(angleOFT, AngleOFT__factory.abi, deployer) as AngleOFT;

  const tx = await contractAngleOFT.setTrustedRemote(ChainId.FANTOM, '0x16cd38b1B54E7abf307Cb2697E2D9321e843d5AA', {
    gasPrice: 400e9,
  });

  console.log(tx);
  await tx.wait();
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
