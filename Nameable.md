# Test

## Storage layout

To be able to test the storage layout, you can run the following command:

```bash
yarn check-upgradeability
```

## Nameable Tests

To be able to first test the nameable, you can run the following command:

```bash
yarn node:instant
```

Then, you can run the tests as follows:

```bash
npx hardhat run scripts/mainnet-fork/upgradeStablecoin.ts --network localhost
```

And before each execution of the tests to change chain you need to uncomment the chain you wants to fork in `hardhat.config.ts`. And you should also change 

```typescript
    const chainIdForked = ChainId.AVALANCHE;
    const stablecoin: 'EUR' | 'USD' = 'EUR';
```

in the file `scripts/mainnet-fork/upgradeStablecoin.ts`.

# Deploy

## Implementation

To deploy the contracts, you can run the following command:

```bash
npx hardhat run scripts/mainnet-fork/upgradeStablecoin.ts --network NETWORK
```

With the part after the `deploy` function being docummented in the file `scripts/mainnet-fork/upgradeStablecoin.ts` and the `NETWORK` being the network you want to deploy the contracts to.

## Foundry

Then, head over to angle-multisig repository and you can use the UpgradeAgTokenNameable script witht the new implementation address and the desired name and symbol.