import chaiModule from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { solidity } from 'ethereum-waffle';

chaiModule.use(chaiAsPromised);
chaiModule.use(solidity);

export = chaiModule;
