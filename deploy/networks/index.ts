import { ChainId, CONSTANTS } from '@angleprotocol/sdk';
import { network } from 'hardhat';

// TODO: to be changed at mainnet deployment
export default CONSTANTS((network.config.chainId == 1 ? 1337 : network.config.chainId) as ChainId);
