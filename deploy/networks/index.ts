import { ChainId, CONSTANTS } from '@angleprotocol/sdk';
import { network } from 'hardhat';

export default CONSTANTS((network.config.chainId == 1337 ? 1 : network.config.chainId) as ChainId);
