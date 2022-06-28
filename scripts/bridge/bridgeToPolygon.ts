import { ChainId, ether } from '@angleprotocol/sdk';
import { Contract } from 'ethers';
import { parseEther } from 'ethers/lib/utils';
import { ethers } from 'hardhat';

import { ZERO_ADDRESS } from '../../test/utils/helpers';
import {
  AgTokenSideChainMultiBridge,
  AgTokenSideChainMultiBridge__factory,
  AngleOFT,
  AngleOFT__factory,
  MockTreasury,
  MockTreasury__factory,
} from '../../typechain';

async function main() {
  const { deployer } = await ethers.getNamedSigners();

  const agToken = (await ethers.getContract('Mock_AgTokenSideChainMultiBridge')).address;
  const contractAgToken = new Contract(
    agToken,
    AgTokenSideChainMultiBridge__factory.abi,
    deployer,
  ) as AgTokenSideChainMultiBridge;

  const treasury = (await ethers.getContract('MockTreasury')).address;
  const contractTreasury = new Contract(treasury, MockTreasury__factory.abi, deployer) as MockTreasury;

  // await (await contractTreasury.addMinter(agToken, deployer.address)).wait();
  await (await contractAgToken.mint(deployer.address, ether(1))).wait();

  const angleOFT = (await ethers.getContract('Mock_AngleOFT')).address;
  const contractAngleOFT = new Contract(angleOFT, AngleOFT__factory.abi, deployer) as AngleOFT;

  // console.log(
  //   await contractAngleOFT.estimateSendFee(
  //     ChainId.POLYGON,
  //     ethers.utils.solidityPack(['address'], [deployer.address]),
  //     parseEther('1'),
  //     false,
  //     ethers.utils.solidityPack(['uint16', 'uint256'], [1, 200000]),
  //     { gasLimit: 12e6 },
  //   ),
  // );

  await (await contractAgToken.approve(contractAngleOFT.address, ether(1), { gasLimit: 5e5, gasPrice: 10e9 })).wait();

  const tx = await contractAngleOFT.sendFrom(
    deployer.address,
    ChainId.POLYGON,
    ethers.utils.solidityPack(['address'], [deployer.address]),
    ether(1),
    deployer.address,
    ZERO_ADDRESS,
    ethers.utils.solidityPack(['uint16', 'uint256'], [1, 200000]),
    { gasLimit: 5e5, gasPrice: 10e9 },
  );
  console.log(tx);

  await tx.wait();
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
