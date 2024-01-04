interface CurrencyNetworkAddresses {
  [network: string]: string;
}

interface OFTsStructure {
  [currency: string]: CurrencyNetworkAddresses;
}

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
    mainnet: '0x4Fa745FCCC04555F2AFA8874cd23961636CdF982',
  },
};
