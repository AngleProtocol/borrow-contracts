import { providers } from 'ethers';
import { ethers } from 'hardhat';

import { CoreBorrow, CoreBorrow__factory } from '../../typechain';

async function main() {
  let core: CoreBorrow;
  const provider = new providers.JsonRpcProvider('https://zkevm-rpc.com');

  const { deployer } = await ethers.getNamedSigners();
  core = new ethers.Contract(
    '0xC16B81Af351BA9e64C1a069E3Ab18c244A1E3049',
    CoreBorrow__factory.createInterface(),
    deployer,
  ) as CoreBorrow;
  const governorRole = await core.GOVERNOR_ROLE();
  const guardianRole = await core.GUARDIAN_ROLE();
  console.log(await core.hasRole(governorRole, '0x9439B96E39dA5AD7EAA75d7a136383D1D9737055'));
  console.log(await core.hasRole(guardianRole, '0x10DeF8a92c51C8082087356186a1485301078DCd'));
  console.log(await core.hasRole(governorRole, '0x10DeF8a92c51C8082087356186a1485301078DCd'));
  console.log(await core.hasRole(guardianRole, '0x9439B96E39dA5AD7EAA75d7a136383D1D9737055'));

  const prev = await provider.send('eth_getStorageAt', [
    '0xC16B81Af351BA9e64C1a069E3Ab18c244A1E3049',
    '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',
    'latest',
  ]);
  console.log(prev);
  // const receipt = await core.implementation();
  // console.log(receipt);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
