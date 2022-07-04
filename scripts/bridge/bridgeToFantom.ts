import { ether } from '@angleprotocol/sdk';
import { Contract } from 'ethers';
import { ethers } from 'hardhat';

import LZ_CHAINIDS from '../../deploy/constants/layerzeroChainIds.json';
import { ZERO_ADDRESS } from '../../test/utils/helpers';
import {
  AgTokenSideChainMultiBridge,
  AgTokenSideChainMultiBridge__factory,
  LayerZeroBridge,
  LayerZeroBridge__factory,
} from '../../typechain';

async function main() {
  const gasLimit = 1e6;
  const gasPrice = 200e9;

  const { deployer } = await ethers.getNamedSigners();

  const agToken = (await ethers.getContract('Mock_AgTokenSideChainMultiBridge')).address;
  const contractAgToken = new Contract(
    agToken,
    AgTokenSideChainMultiBridge__factory.abi,
    deployer,
  ) as AgTokenSideChainMultiBridge;

  const angleOFT = (await ethers.getContract('Mock_LayerZeroBridge')).address;
  const contractAngleOFT = new Contract(angleOFT, LayerZeroBridge__factory.abi, deployer) as LayerZeroBridge;

  await (
    await contractAgToken.approve(contractAngleOFT.address, ethers.constants.MaxUint256, { gasLimit, gasPrice })
  ).wait();

  const estimate = await contractAngleOFT.estimateSendFee(
    LZ_CHAINIDS.fantom,
    ethers.utils.solidityPack(['address'], [deployer.address]),
    ether(0.5),
    false,
    ethers.utils.solidityPack(['uint16', 'uint256'], [1, 200000]),
    { gasLimit },
  );
  console.log(estimate[0]?.toString());

  const tx = await contractAngleOFT.send(
    LZ_CHAINIDS.fantom,
    ethers.utils.solidityPack(['address'], [deployer.address]),
    ether(0.5),
    deployer.address,
    ZERO_ADDRESS,
    ethers.utils.solidityPack(['uint16', 'uint256'], [1, 200000]),
    { gasLimit, gasPrice, value: estimate[0] },
  );
  console.log(tx);

  await tx.wait();
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
