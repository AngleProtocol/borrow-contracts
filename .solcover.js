module.exports = {
  norpc: true,
  testCommand: 'yarn test',
  compileCommand: 'yarn compile:hardhat',
  skipFiles: [
    'mock',
    'external',
    'interfaces',
    'oracle/OracleChainlinkMultiTemplate.sol',
    'oracle/implementations/OracleWSTETHEURChainlink.sol',
    'oracle/implementations/OracleBTCEURChainlink.sol',
    'oracle/implementations/OracleETHEURChainlink.sol',
  ],
  providerOptions: {
    default_balance_ether: '10000000000000000000000000',
  },
  mocha: {
    fgrep: '[skip-on-coverage]',
    invert: true,
  },
};
