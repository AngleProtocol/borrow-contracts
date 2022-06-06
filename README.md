# <img src="logo.svg" alt="Angle Borrowing Module" height="40px"> Angle Borrowing Module

[![CI](https://github.com/AngleProtocol/angle-borrow/workflows/CI/badge.svg)](https://github.com/AngleProtocol/angle-borrow/actions?query=workflow%3ACI)
[![Docs](https://img.shields.io/badge/docs-%F0%9F%93%84-blue)](https://docs.angle.money/angle-borrowing-module/borrowing-module)
[![Developers](https://img.shields.io/badge/developers-%F0%9F%93%84-pink)](https://developers.angle.money/borrowing-module-contracts/architecture-overview)

## Documentation

### To Start With

Angle is a decentralized stablecoin protocol, designed to be both over-collateralized and capital-efficient. For more information about the protocol, you can refer to [Angle Documentation](https://docs.angle.money).

The protocol is made of different modules, each with their own set of smart contracts. This repo contains the Borrowing module smart contracts.

Documentation to understand Angle Protocol's Borrowing Module is available [here](https://docs.angle.money).

Developers documentation to understand how these smart contracts work together is available [here](https://developers.angle.money/borrowing-module-contracts/architecture-overview).

Whitepaper for the module can be found [here](https://docs.angle.money/overview/whitepapers).

### Further Information

For a broader overview of the protocol and its different modules, you can also check [this overview page](https://developers.angle.money) of our developers documentation.

Other Angle-related smart contracts can be found in the following repositories:

- [Angle Core module contracts](https://github.com/AngleProtocol/angle-core)
- [Angle Strategies](https://github.com/AngleProtocol/angle-strategies)

Otherwise, for more info about the protocol, check out [this portal](https://linktr.ee/angleprotocol) of resources.

## Module Architecture

![Module Architecture](AngleBorrowingArchitecture.png)

### Remarks

### Cross-module Contracts

Some smart contracts of the protocol are used across the different modules of Angle (like the `agToken` contract) and you'll sometimes see different versions across the different repositories of the protocol.

Here are some cross-module contracts and the repos in which you should look for their correct and latest version:

- [`angle-core`](https://github.com/AngleProtocol/angle-core): All DAO-related contracts (`ANGLE`, `veANGLE`, gauges, surplus distribution, ...), `AngleRouter` contract
- [`angle-borrow`](https://github.com/AngleProtocol/angle-borrow): `agToken` contract
- [`angle-strategies`](https://github.com/AngleProtocol/angle-strategies): Yield strategies of the protocol

### Error Messages

Some smart contracts use error messages. These error messages are sometimes encoded in numbers rather than as custom errors like done most of the time. The conversion from numbers to error messages can be found in `errorMessages.json`.

## Setup

To install all the packages needed to run the tests, run:
`yarn`

### Setup environment

Create a `.env` file from the template file `.env.example`.
If you don't define URI and mnemonics, default mnemonic will be used with a brand new local hardhat node.

## Contracts usage

### Compilation

```shell
yarn compile
```

### Testing

```shell
yarn test
```

Defaults with `hardhat` network, but another network can be specified with `--network NETWORK_NAME`.

A single test file or a glob pattern can be appended to launch a reduced set of tests:

```shell
yarn test tests/vaultManager/*
```

### Scripts

`yarn hardhat run PATH_TO_SCRIPT`

Some scripts require to fork mainnet. To do so, you must first ensure that the `ETH_NODE_URI_FORK` in `.env` is pointing to an archival node (note: Alchemy provides this functionnality for free but Infura doesn't).

Then, uncomment `blockNumber` in the `hardhat` network definition inside `hardhat.config.ts` to boost node speed.
Then run:

```shell
FORK=true yarn hardhat run PATH_TO_SCRIPT
```

### Coverage

We try to keep our contract's code coverage above 99%. All contract code additions should be covered by tests (locally and in mainnet-fork) before being merged and deployed on mainnet.

To run code coverage:

```shell
yarn coverage
```

A subgroup of tests can be run by specifying `--testfiles "path/to/tests/*.ts"`.

If coverage runs out of memory, you can export this in your env and retry:

```shell
export NODE_OPTIONS=--max_old_space_size=4096
```

### Troubleshooting

If you have issues running tests or scripts, you can try to regenerate contracts typescript bindings by running

```shell
yarn generate-types-from-abis
```

You can also delete `node_modules`, `cache`, and then re-install dependancies with `yarn install --frozen-lockfile`.

## Audits

The contracts of this module have been audited by [Chainsecurity](https://chainsecurity.com/security-audit/angle-protocol-borrowing-module/). The audit reports can be found in the `audits/` folder of this repo.

All Angle Protocol related audits can be found in [this page](https://docs.angle.money/resources/audits) of our docs.

## Bug Bounty

At Angle, we consider the security of our systems a top priority. But even putting top priority status and maximum effort, there is still possibility that vulnerabilities exist.

We have therefore setup a bug bounty program with the help of Immunefi. The Angle Protocol bug bounty program is focused around our smart contracts with a primary interest in the prevention of:

- Thefts and freezing of principal of any amount
- Thefts and freezing of unclaimed yield of any amount
- Theft of governance funds
- Governance activity disruption

For more details, please refer to the [official page of the bounty on Immunefi](https://immunefi.com/bounty/angleprotocol/).

| Level    |                     |
| :------- | :------------------ |
| Critical | up to USD \$500,000 |
| High     | USD \$20,000        |
| Medium   | USD \$2,500         |

All bug reports must include a Proof of Concept demonstrating how the vulnerability can be exploited to be eligible for a reward. This may be a smart contract itself or a transaction.
