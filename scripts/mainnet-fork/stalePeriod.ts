import { BigNumber } from 'ethers';
import { ethers, network } from 'hardhat';

import { BaseOracleChainlinkMulti } from '../../typechain';

async function main() {
  const { deployer } = await ethers.getNamedSigners();

  // const oracleAddress = await vaultManager.oracle();
  const oracleAddresses = [
    '0xc9Cb5703C109D4Fe46d2F29b0454c434e42A6947',
    '0x2859a4eBcB58c8Dd5cAC1419C4F63A071b642B20',
    '0x236D9032d96226b900B0D557Ae6Fd202f3a26b6a',
    '0xbf2a9659Cb9f3E2E83A1a4D5A2D5e6eFCDFC13d1',
  ];

  for (const oracleAddress of oracleAddresses) {
    try {
      const oracle = (await ethers.getContractAt(
        'BaseOracleChainlinkMulti',
        oracleAddress,
      )) as BaseOracleChainlinkMulti;

      const governor = '0xdC4e6DFe07EFCa50a197DF15D9200883eF4Eb1c8';

      await network.provider.request({
        method: 'hardhat_impersonateAccount',
        params: [governor],
      });
      await network.provider.send('hardhat_setBalance', [governor, '0x10000000000000000000000000000']);
      const signer = await ethers.getSigner(governor);

      await (await oracle.connect(signer).changeStalePeriod(BigNumber.from(2).pow(31))).wait();

      console.log('Success');
    } catch (error) {
      console.log(error);
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
