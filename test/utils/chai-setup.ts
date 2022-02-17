import chaiModule from 'chai';
import { solidity } from 'ethereum-waffle';
import chaiAsPromised from 'chai-as-promised';

chaiModule.use(chaiAsPromised);
chaiModule.use(solidity);

export = chaiModule;
