import { Contract } from 'ethers';
import { ethers } from 'hardhat';

import LZ_CHAINIDS from '../../deploy/constants/layerzeroChainIds.json';
import { AngleOFT, AngleOFT__factory } from '../../typechain';

async function main() {
  const { deployer } = await ethers.getNamedSigners();

  const angleOFT = (await ethers.getContract('Mock_AngleOFT')).address;
  const contractAngleOFT = new Contract(angleOFT, AngleOFT__factory.abi, deployer) as AngleOFT;

  const tx = await contractAngleOFT.setTrustedRemote(LZ_CHAINIDS.fantom, '0x5EE94c25e3d5113CD055537340B9d19CFA4D9217', {
    gasPrice: 400e9,
  });

  console.log(tx);
  await tx.wait();
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
