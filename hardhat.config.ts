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

import { accounts, etherscanKey, getPkey, nodeUrl } from './utils/network';

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
        version: '0.8.17',
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
      'contracts/vaultManager/VaultManagerListing.sol': {
        version: '0.8.12',
        settings: {
          optimizer: {
            enabled: true,
            runs: 1,
          },
        },
      },
      'contracts/vaultManager/VaultManagerLiquidationBoost.sol': {
        version: '0.8.12',
        settings: {
          optimizer: {
            enabled: true,
            runs: 1,
          },
        },
      },
      'contracts/vaultManager/VaultManagerERC1155Receiver.sol': {
        version: '0.8.12',
        settings: {
          optimizer: {
            enabled: true,
            runs: 1,
          },
        },
      },
      'contracts/deprecated/OldVaultManager.sol': {
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
      'contracts/router/AngleRouter01.sol': {
        version: '0.8.12',
        settings: {
          optimizer: {
            enabled: true,
            runs: 1,
          },
        },
      },
      'contracts/deprecated/vaultManager/OldVaultManager.sol': {
        version: '0.8.12',
        settings: {
          optimizer: {
            enabled: true,
            runs: 1,
          },
        },
      },
      'contracts/mock/MockUpdater.sol': {
        version: '0.4.26',
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
        // url: nodeUrl('mainnet'),
        // blockNumber: 19340884,

        // Optimism
        // url: nodeUrl('optimism'),
        // blockNumber: 116855226,

        // Arbitrum
        // url: nodeUrl('arbitrum'),
        // blockNumber: 188286007,

        // Polygon
        url: nodeUrl('polygon'),
        blockNumber: 54141400,

        // Gnosis
        // url: nodeUrl('gnosis'),
        // blockNumber: 32825438,

        // Linea
        // url: nodeUrl('linea'),
        // blockNumber: 2613012,

        // BSC
        // url: nodeUrl('bsc'),
        // blockNumber: 36786797,

        // Celo
        // url: nodeUrl('celo'),
        // blockNumber: 24444656,

        // Avalanche
        // url: nodeUrl('avalanche'),
        // blockNumber: 42633334,

        // Polygon zkEVM
        // url: nodeUrl('polygonzkevm'),
        // blockNumber: 10570826,

        // Base
        // url: nodeUrl('base'),
        // blockNumber: 11261506,
      },
      mining: argv.disableAutoMining
        ? {
            auto: false,
            interval: 1000,
          }
        : { auto: true },
      chainId: 0,
    },
    polygon: {
      live: true,
      url: nodeUrl('polygon'),
      accounts: [getPkey()],
      gas: 'auto',
      chainId: 137,
      verify: {
        etherscan: {
          apiKey: etherscanKey('polygon'),
        },
      },
    },
    mainnet: {
      live: true,
      url: nodeUrl('mainnet'),
      accounts: [getPkey()],
      gas: 'auto',
      gasMultiplier: 1.3,
      // gasPrice: 50000000000,
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
      accounts: [getPkey()],
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
      accounts: [getPkey()],
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
      accounts: [getPkey()],
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
      accounts: [getPkey()],
      gas: 'auto',
      chainId: 56,
      verify: {
        etherscan: {
          apiKey: etherscanKey('bsc'),
        },
      },
    },
    celo: {
      live: true,
      url: nodeUrl('celo'),
      accounts: [getPkey()],
      gas: 'auto',
      chainId: 42220,
      verify: {
        etherscan: {
          apiKey: etherscanKey('celo'),
        },
      },
    },
    gnosis: {
      live: true,
      url: nodeUrl('gnosis'),
      accounts: [getPkey()],
      gas: 'auto',
      gasMultiplier: 2,
      chainId: 100,
      initialBaseFeePerGas: 1000000000,
      verify: {
        etherscan: {
          apiKey: etherscanKey('gnosis'),
        },
      },
    },
    polygonzkevm: {
      live: true,
      url: nodeUrl('polygonzkevm'),
      accounts: [getPkey()],
      gas: 'auto',
      gasMultiplier: 1.3,
      chainId: 1101,
      verify: {
        etherscan: {
          apiKey: etherscanKey('polygonzkevm'),
        },
      },
    },
    base: {
      live: true,
      url: nodeUrl('base'),
      accounts: [getPkey()],
      gas: 'auto',
      gasMultiplier: 1.3,
      chainId: 8453,
      verify: {
        etherscan: {
          apiKey: etherscanKey('base'),
        },
      },
    },
    linea: {
      live: true,
      url: nodeUrl('linea'),
      accounts: [getPkey()],
      gas: 'auto',
      gasMultiplier: 1.3,
      chainId: 59144,
      verify: {
        etherscan: {
          apiKey: etherscanKey('linea'),
        },
      },
    },
    zksync: {
      live: true,
      url: nodeUrl('zksync'),
      accounts: accounts('zksync'),
      gas: 'auto',
      gasMultiplier: 1.3,
      chainId: 324,
      verify: {
        etherscan: {
          apiKey: etherscanKey('zksync'),
        },
      },
    },
    mantle: {
      live: true,
      url: nodeUrl('mantle'),
      accounts: accounts('mantle'),
      gas: 'auto',
      gasMultiplier: 1.3,
      chainId: 5000,
      verify: {
        etherscan: {
          apiKey: etherscanKey('mantle'),
        },
      },
    },
    filecoin: {
      live: true,
      url: nodeUrl('filecoin'),
      accounts: accounts('filecoin'),
      gas: 'auto',
      gasMultiplier: 1.3,
      chainId: 314,
      verify: {
        etherscan: {
          apiKey: etherscanKey('filecoin'),
        },
      },
    },
    thundercore: {
      live: true,
      url: nodeUrl('thundercore'),
      accounts: accounts('thundercore'),
      gas: 'auto',
      gasMultiplier: 1.3,
      chainId: 108,
      verify: {
        etherscan: {
          apiKey: etherscanKey('thundercore'),
        },
      },
    },
    coredao: {
      live: true,
      url: nodeUrl('coredao'),
      accounts: accounts('coredao'),
      gas: 'auto',
      gasMultiplier: 1.3,
      chainId: 1116,
      verify: {
        etherscan: {
          apiKey: etherscanKey('coredao'),
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
    // {
    //   polygon: process.env.POLYGON_ETHERSCAN_API_KEY,
    //   mainnet: process.env.MAINNET_ETHERSCAN_API_KEY,
    //   optimism: process.env.OPTIMISM_ETHERSCAN_API_KEY,
    //   arbitrum: process.env.ARBITRUM_ETHERSCAN_API_KEY,
    //   avalanche: process.env.AVALANCHE_ETHERSCAN_API_KEY,
    //   bsc: process.env.BSC_ETHERSCAN_API_KEY,
    //   celo: process.env.CELO_ETHERSCAN_API_KEY,
    //   gnosis: process.env.GNOSIS_ETHERSCAN_API_KEY,
    //   polygonzkevm: process.env.POLYGON_ZKEVM_ETHERSCAN_API_KEY,
    //   base: process.env.BASE_ETHERSCAN_API_KEY,
    // linea: process.env.LINEA_ETHERSCAN_API_KEY,
    // },
    customChains: [
      {
        network: 'linea',
        chainId: 59144,
        urls: {
          apiURL: 'https://api.lineascan.build/api',
          browserURL: 'https://lineascan.build/',
        },
      },
    ],
  },
  typechain: {
    outDir: 'typechain',
    target: 'ethers-v5',
  },
};

export default config;
