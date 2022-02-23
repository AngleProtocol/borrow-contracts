import { ChainId, CONSTANTS } from '@angleprotocol/sdk';
import { network } from 'hardhat';

// In case it is a mainnet fork, take the appropriate params
export default CONSTANTS((network.live && network.config.chainId === 1337 ? 1 : network.config.chainId) as ChainId);
