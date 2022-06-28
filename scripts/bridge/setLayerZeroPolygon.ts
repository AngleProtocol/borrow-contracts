import { ChainId } from '@angleprotocol/sdk';
import { Contract } from 'ethers';
import { ethers } from 'hardhat';

import { AngleOFT, AngleOFT__factory } from '../../typechain';

async function main() {
  const { deployer } = await ethers.getNamedSigners();

  const angleOFT = (await ethers.getContract('Mock_AngleOFT')).address;
  const contractAngleOFT = new Contract(angleOFT, AngleOFT__factory.abi, deployer) as AngleOFT;

  await (await contractAngleOFT.setTrustedRemote(ChainId.POLYGON, '0x42dC54fb50dB556fA6ffBa765F1141536d4830ea')).wait();
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
