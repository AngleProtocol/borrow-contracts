/*
TO RUN THIS SCRIPT, use the `updateOracle` function.
Pass the Chainlink Oracle address, and the value you want the Oracle to have.

!!! And don't forget to update the `provider`

Ex:
await updateOracle('0x0606Be69451B1C9861Ac6b3626b99093b713E801', utils.parseUnits('1.0253', 8));
*/

import { BigNumber, Contract, providers, utils } from 'ethers';

// const provider = new providers.JsonRpcProvider('http://35.205.150.180:11055');
const provider = new providers.JsonRpcProvider('http://127.0.0.1:8545');

// We use this function to find the slot for Transmission struct
async function findTransmissionSlot(_aggregator: string): Promise<number> {
  //   struct Transmission {
  //     int192 answer; // 192 bits ought to be enough for anyone
  //     uint64 timestamp;
  //   }
  const answer = 34;
  const probe = utils.solidityPack(['uint64', 'int192'], [12, answer]);
  console.log(probe);

  const aggregator = new Contract(
    _aggregator,
    [
      'function latestRoundData() public view returns (uint80 roundId,int256 answer,uint256 startedAt,uint256 updatedAt,uint80 answeredInRound)',
    ],
    provider,
  );
  const roundId = (await aggregator.latestRoundData()).roundId;

  for (let i = 0; i < 100; i++) {
    let probedSlot = utils.keccak256(utils.defaultAbiCoder.encode(['uint32', 'uint'], [roundId, i]));

    // remove padding for JSON RPC
    while (probedSlot.startsWith('0x0')) probedSlot = '0x' + probedSlot.slice(3);

    const prev = await provider.send('eth_getStorageAt', [_aggregator, probedSlot, 'latest']);
    await provider.send('hardhat_setStorageAt', [_aggregator, probedSlot, probe]);
    const latestRoundData = await aggregator.latestRoundData();
    await provider.send('hardhat_setStorageAt', [_aggregator, probedSlot, prev]); // reset to previous value

    if (latestRoundData.answer.eq(BigNumber.from(answer))) return i;
  }

  throw new Error('Balances slot not found!');
}

export async function updateOracle(oracle: string, value: BigNumber): Promise<void> {
  const feed = new Contract(
    oracle,
    [
      'function latestRoundData() public view returns (uint80 roundId,int256 answer,uint256 startedAt,uint256 updatedAt,uint80 answeredInRound)',
      'function aggregator() external view returns (address)',
    ],
    provider,
  );

  const aggregator = new Contract(
    await feed.aggregator(),
    [
      'function latestRoundData() public view returns (uint80 roundId,int256 answer,uint256 startedAt,uint256 updatedAt,uint80 answeredInRound)',
      'function latestRound() public view returns (uint256)',
    ],
    provider,
  );

  // This returns the slot 43
  //   console.log('slot', await findTransmissionSlot(aggregator.address));

  const roundId = (await aggregator.latestRoundData()).roundId;

  const timestamp = (await provider.getBlock('latest')).timestamp;

  const slot = utils.keccak256(utils.defaultAbiCoder.encode(['uint32', 'uint'], [roundId, 43]));

  console.log('before', await feed.latestRoundData());

  /*
  This sets the storage for the mapping s_transmissions
    struct Transmission {
    int192 answer;
    uint64 timestamp;
    }
    mapping(uint32 => Transmission) internal s_transmissions;
  */
  await provider.send('hardhat_setStorageAt', [
    aggregator.address,
    slot,
    utils.solidityPack(['uint64', 'int192'], [timestamp, value.toHexString()]),
  ]);

  /*
  This sets the storage for the mapping s_hotVars
    struct HotVars {
    bytes16 latestConfigDigest;
    uint40 latestEpochAndRound;
    uint8 threshold;
    uint32 latestAggregatorRoundId;
    }
    HotVars internal s_hotVars;
  */
  await provider.send('hardhat_setStorageAt', [
    aggregator.address,
    `0x${(42).toString(16)}`,
    utils.hexZeroPad(
      utils.solidityPack(
        ['uint32', 'uint8', 'uint40', 'bytes16'],
        [roundId, 8, 9, '0xaaa10db8000000000000000000000aaa'],
      ),
      32,
    ),
  ]);

  console.log('after', await feed.latestRoundData());
}

// (async () => {
//   await updateOracle('0xb49f677943BC038e9857d61E7d053CaA2C1734C1', utils.parseUnits('1.08', 8));
//   console.log('updated oracle');
// })();
