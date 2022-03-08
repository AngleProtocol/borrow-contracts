import { ChainId, CONSTANTS } from '@angleprotocol/sdk';
import { network } from 'hardhat';

export default CONSTANTS(network.config.chainId as ChainId);
