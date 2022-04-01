/// ENVVAR
// - ENABLE_GAS_REPORT
// - CI
// - RUNS
import 'dotenv/config';
import 'hardhat-contract-sizer';
import 'hardhat-spdx-license-identifier';
import 'hardhat-docgen';
import 'hardhat-deploy';
import 'hardhat-abi-exporter';
import '@nomiclabs/hardhat-ethers';
import '@nomiclabs/hardhat-truffle5';
import '@nomiclabs/hardhat-solhint';
import '@nomiclabs/hardhat-vyper';
import '@openzeppelin/hardhat-upgrades';
import 'solidity-coverage';
import '@tenderly/hardhat-tenderly';
import '@typechain/hardhat';

import { HardhatUserConfig } from 'hardhat/config';
import yargs from 'yargs';

import { accounts, nodeUrl } from './utils/network';

const argv = yargs
  .env('')
  .boolean('enableGasReport')
  .boolean('ci')
  .number('runs')
  .boolean('fork')
  .boolean('disableAutoMining')
  .parseSync();

if (argv.enableGasReport) {
  import('hardhat-gas-reporter'); // eslint-disable-line
}

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: '0.8.12',
        settings: {
          optimizer: {
            enabled: true,
            runs: 1,
          },
          // debug: { revertStrings: 'strip' },
        },
      },
    ],
  },
  defaultNetwork: 'hardhat',
  networks: {
    hardhat: {
      accounts: accounts('mainnet'),
      live: false,
      blockGasLimit: 125e5,
      initialBaseFeePerGas: 0,
      hardfork: 'london',
      forking: {
        enabled: argv.fork || false,
        url: nodeUrl('forkpolygon'),
        // For Polygon
        blockNumber: 26536036,
        // For mainnet
        // blockNumber: 14256515,
      },
      mining: argv.disableAutoMining
        ? {
            auto: false,
            interval: 1000,
          }
        : { auto: true },
      chainId: 1337,
    },
    rinkeby: {
      live: true,
      url: nodeUrl('rinkeby'),
      accounts: accounts('rinkeby'),
      gas: 'auto',
      // gasPrice: 12e8,
      chainId: 4,
    },
    mumbai: {
      live: true,
      url: nodeUrl('mumbai'),
      accounts: accounts('mumbai'),
      gas: 'auto',
    },
    polygon: {
      live: true,
      url: nodeUrl('polygon'),
      accounts: accounts('polygon'),
      gas: 'auto',
    },
    mainnet: {
      live: true,
      url: nodeUrl('mainnet'),
      accounts: accounts('mainnet'),
      gas: 'auto',
      gasMultiplier: 1.3,
      chainId: 1,
    },
  },
  paths: {
    sources: './contracts',
    tests: './test',
  },
  namedAccounts: {
    deployer: 0,
    guardian: 1,
    governor: 2,
    proxyAdmin: 3,
    alice: 4,
    bob: 5,
    charlie: 6,
  },
  contractSizer: {
    alphaSort: true,
    runOnCompile: false,
    disambiguatePaths: false,
  },
  gasReporter: {
    currency: 'USD',
    outputFile: argv.ci ? 'gas-report.txt' : undefined,
  },
  spdxLicenseIdentifier: {
    overwrite: true,
    runOnCompile: false,
  },
  docgen: {
    path: './docs',
    clear: true,
    runOnCompile: false,
  },
  abiExporter: {
    path: './export/abi',
    clear: true,
    flat: true,
    spacing: 2,
  },
  tenderly: {
    project: process.env.TENDERLY_PROJECT || '',
    username: process.env.TENDERLY_USERNAME || '',
  },
  typechain: {
    outDir: 'typechain',
    target: 'ethers-v5',
  },
};

export default config;
