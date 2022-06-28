import { Contract } from 'ethers';
import { ethers } from 'hardhat';

import LZ_CHAINIDS from '../../deploy/constants/layerzeroChainIds.json';
import { AngleOFT, AngleOFT__factory } from '../../typechain';

async function main() {
  const { deployer } = await ethers.getNamedSigners();

  const angleOFT = (await ethers.getContract('Mock_AngleOFT')).address;
  const contractAngleOFT = new Contract(angleOFT, AngleOFT__factory.abi, deployer) as AngleOFT;

  await (
    await contractAngleOFT.setTrustedRemote(LZ_CHAINIDS.polygon, '0x42dC54fb50dB556fA6ffBa765F1141536d4830ea')
  ).wait();
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
