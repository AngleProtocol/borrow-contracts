import { ChainId, parseAmount } from '@angleprotocol/sdk/dist';
import { BigNumber } from 'ethers';
import { parseEther } from 'ethers/lib/utils';
// Mined address for the stablecoin
export const minedAddress = '0x0000206329b97DB379d5E1Bf586BbDB969C63274';
export const stableName = 'USD';
export const vaultsList = ['wstETH'];
export const forkedChain = ChainId.MAINNET;
export const forkedChainName = 'mainnet';

export const immutableCreate2Factory = '0x0000000000FFe8B47B3e2130213B802212439497';

export const OFTs: OFTsStructure = {
  EUR: {
    polygon: '0x0c1EBBb61374dA1a8C57cB6681bF27178360d36F',
    optimism: '0x840b25c87B626a259CA5AC32124fA752F0230a72',
    arbitrum: '0x16cd38b1B54E7abf307Cb2697E2D9321e843d5AA',
    mainnet: '0x4Fa745FCCC04555F2AFA8874cd23961636CdF982',
    avalanche: '0x14C00080F97B9069ae3B4Eb506ee8a633f8F5434',
    bsc: '0xe9f183FC656656f1F17af1F2b0dF79b8fF9ad8eD',
    celo: '0xf1dDcACA7D17f8030Ab2eb54f2D9811365EFe123',
    gnosis: '0xFA5Ed56A203466CbBC2430a43c66b9D8723528E7',
    polygonzkevm: '0x2859a4eBcB58c8Dd5cAC1419C4F63A071b642B20',
    base: '0x2859a4eBcB58c8Dd5cAC1419C4F63A071b642B20',
    linea: '0x12f31B73D812C6Bb0d735a218c086d44D5fe5f89',
    mantle: '0x2859a4eBcB58c8Dd5cAC1419C4F63A071b642B20',
  },
  USD: {
    // TODO: update because mock
    mainnet: '0x4Fa745FCCC04555F2AFA8874cd23961636CdF982',
  },
};

interface CurrencyNetworkAddresses {
  [network: string]: string;
}

interface OFTsStructure {
  [currency: string]: CurrencyNetworkAddresses;
}

export const interestRate5 = BigNumber.from('1547125982881425408');

export const vaultManagers = {
  USD: {
    vaults: [
      {
        collateral: '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0',
        symbol: 'wstETH-USD',
        oracle: 'WSTETH_USD',
        params: {
          debtCeiling: parseEther('1000'),
          collateralFactor: parseAmount.gwei('0.75'),
          targetHealthFactor: parseAmount.gwei('1.05'),
          borrowFee: parseAmount.gwei('0'),
          repayFee: parseAmount.gwei('0'),
          interestRate: interestRate5,
          liquidationSurcharge: parseAmount.gwei('0.98'),
          maxLiquidationDiscount: parseAmount.gwei('0.1'),
          whitelistingActivated: false,
          baseBoost: parseAmount.gwei('1.5'),
          dust: parseEther('0'),
          dustCollateral: parseEther('0'),
          dustLiquidation: parseEther('10'),
        },
      },
    ],
  },
};
