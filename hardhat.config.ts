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
import '@nomiclabs/hardhat-etherscan';
import '@openzeppelin/hardhat-upgrades';
import 'solidity-coverage';
import '@tenderly/hardhat-tenderly';
import '@typechain/hardhat';

import { TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS } from 'hardhat/builtin-tasks/task-names';
import { HardhatUserConfig, subtask } from 'hardhat/config';
import yargs from 'yargs';

import { accounts, etherscanKey, nodeUrl } from './utils/network';

// Otherwise, ".sol" files from "test" are picked up during compilation and throw an error
subtask(TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS).setAction(async (_, __, runSuper) => {
  const paths = await runSuper();
  return paths.filter((p: string) => !p.includes('/test/foundry/'));
});

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
            runs: 1000000,
          },
          // debug: { revertStrings: 'strip' },
        },
      },
    ],
    overrides: {
      'contracts/vaultManager/VaultManager.sol': {
        version: '0.8.12',
        settings: {
          optimizer: {
            enabled: true,
            runs: 1,
          },
        },
      },
      'contracts/helpers/AngleHelpers.sol': {
        version: '0.8.12',
        settings: {
          optimizer: {
            enabled: true,
            runs: 1,
          },
        },
      },
      'contracts/reactor/EulerReactor.sol': {
        version: '0.8.12',
        settings: {
          optimizer: {
            enabled: true,
            runs: 1000,
          },
        },
      },
      'contracts/router/AngleRouter01.sol': {
        version: '0.8.12',
        settings: {
          optimizer: {
            enabled: true,
            runs: 1,
          },
        },
      },
    },
  },
  defaultNetwork: 'hardhat',
  // For the lists of Chain ID: https://chainlist.org
  networks: {
    hardhat: {
      accounts: accounts('mainnet'),
      live: false,
      blockGasLimit: 125e5,
      initialBaseFeePerGas: 0,
      hardfork: 'london',
      forking: {
        enabled: argv.fork || false,
        // Mainnet
        url: nodeUrl('fork'),
        blockNumber: 15868074,
        // Polygon
        /*
        url: nodeUrl('forkpolygon'),
        blockNumber: 31505333,
        */
        // Optimism
        /*
        url: nodeUrl('optimism'),
        blockNumber: 17614765,
        */
        // Arbitrum
        /*
        url: nodeUrl('arbitrum'),
        blockNumber: 19356874,
        */
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
    mainnetForkRemote: {
      live: false,
      url: nodeUrl('mainnetForkRemote'),
      chainId: 1,
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
      chainId: 137,
      gasPrice: 200e9,
      verify: {
        etherscan: {
          apiKey: etherscanKey('polygon'),
        },
      },
    },
    fantom: {
      live: true,
      url: nodeUrl('fantom'),
      accounts: accounts('fantom'),
      gas: 'auto',
      chainId: 250,
    },
    mainnet: {
      live: true,
      url: nodeUrl('mainnet'),
      accounts: accounts('mainnet'),
      gas: 'auto',
      gasMultiplier: 1.3,
      chainId: 1,
      verify: {
        etherscan: {
          apiKey: etherscanKey('mainnet'),
        },
      },
    },
    optimism: {
      live: true,
      url: nodeUrl('optimism'),
      accounts: accounts('optimism'),
      gas: 'auto',
      chainId: 10,
      verify: {
        etherscan: {
          apiKey: etherscanKey('optimism'),
        },
      },
    },
    arbitrum: {
      live: true,
      url: nodeUrl('arbitrum'),
      accounts: accounts('arbitrum'),
      gas: 'auto',
      chainId: 42161,
      verify: {
        etherscan: {
          apiKey: etherscanKey('arbitrum'),
        },
      },
    },
    avalanche: {
      live: true,
      url: nodeUrl('avalanche'),
      accounts: accounts('avalanche'),
      gas: 'auto',
      chainId: 43114,
      verify: {
        etherscan: {
          apiKey: etherscanKey('avalanche'),
        },
      },
    },
    bsc: {
      live: true,
      url: nodeUrl('bsc'),
      accounts: accounts('bsc'),
      gas: 'auto',
      chainId: 56,
      verify: {
        etherscan: {
          apiKey: etherscanKey('bsc'),
        },
      },
    },
    aurora: {
      live: true,
      url: nodeUrl('aurora'),
      accounts: accounts('aurora'),
      gas: 'auto',
      chainId: 1313161554,
    },
  },
  paths: {
    sources: './contracts',
    tests: './test',
    cache: 'cache-hh',
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
  etherscan: {
    apiKey: process.env.BSC_ETHERSCAN_API_KEY,
  },
  typechain: {
    outDir: 'typechain',
    target: 'ethers-v5',
  },
};

export default config;
