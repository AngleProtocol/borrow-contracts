/* eslint-disable camelcase */

import { ChainId, CONTRACTS_ADDRESSES } from '@angleprotocol/sdk';
import { expect } from 'chai';
import { Contract, utils } from 'ethers';
import { ethers, network } from 'hardhat';

async function main() {
  const { Governor, Guardian, SurplusConverterSanTokens_EUR_USDC, SurplusConverterUniV3_IntraCollaterals } =
    CONTRACTS_ADDRESSES[ChainId.MAINNET];

  const NEW_KEEPER = '0xcC617C6f9725eACC993ac626C7efC6B96476916E';

  await network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [Guardian],
  });
  await network.provider.send('hardhat_setBalance', [
    Guardian,
    utils.parseEther('10').toHexString().replace('0x0', '0x'),
  ]);

  const guardian = await ethers.getSigner(Guardian!);

  // 1. Change keeper on Aave Flashloan Strategy
  const stratFlashLoanUSDC = CONTRACTS_ADDRESSES[ChainId.MAINNET].agEUR.collaterals?.USDC.Strategies
    ?.AaveFlashloan as string;
  const strategyAaveFlashloanUSDC = new Contract(
    stratFlashLoanUSDC,
    [
      'function grantRole(bytes32 role, address account) external',
      'function hasRole(bytes32 role, address account) public view returns(bool)',
      'function KEEPER_ROLE() external view returns(bytes32)',
    ],
    ethers.provider,
  );
  const KEEPER_ROLE = await strategyAaveFlashloanUSDC.KEEPER_ROLE();
  await strategyAaveFlashloanUSDC.connect(guardian).grantRole(KEEPER_ROLE, NEW_KEEPER);
  console.log('New keeper has role: ', await strategyAaveFlashloanUSDC.hasRole(KEEPER_ROLE, NEW_KEEPER));

  // 2. Change keeper on GenericCompound
  const collats = ['USDC', 'DAI'];
  for (const collat of collats) {
    const genericCompound = CONTRACTS_ADDRESSES[ChainId.MAINNET].agEUR.collaterals?.[collat].GenericCompound;
    const strategyGenericCompound = new Contract(
      genericCompound!,
      [
        'function grantRole(bytes32 role, address account) external',
        'function hasRole(bytes32 role, address account) public view returns(bool)',
        'function KEEPER_ROLE() external view returns(bytes32)',
      ],
      ethers.provider,
    );

    await strategyGenericCompound.connect(guardian).grantRole(KEEPER_ROLE, NEW_KEEPER);
    console.log('New keeper has role: ', await strategyGenericCompound.hasRole(KEEPER_ROLE, NEW_KEEPER));
  }

  // 3. Change on SurplusConverter
  const surplusConverter1 = new Contract(
    SurplusConverterSanTokens_EUR_USDC as string,
    [
      'function grantRole(bytes32 role, address account) external',
      'function hasRole(bytes32 role, address account) public view returns(bool)',
      'function WHITELISTED_ROLE() external view returns(bytes32)',
    ],
    ethers.provider,
  );
  const surplusConverter2 = new Contract(
    SurplusConverterUniV3_IntraCollaterals!,
    [
      'function grantRole(bytes32 role, address account) external',
      'function hasRole(bytes32 role, address account) public view returns(bool)',
      'function WHITELISTED_ROLE() external view returns(bytes32)',
    ],
    ethers.provider,
  );
  const WHITELISTED_ROLE = await surplusConverter1.WHITELISTED_ROLE();
  await surplusConverter1.connect(guardian).grantRole(WHITELISTED_ROLE, NEW_KEEPER);
  await surplusConverter2.connect(guardian).grantRole(WHITELISTED_ROLE, NEW_KEEPER);
  console.log('New keeper has role: ', await surplusConverter1.hasRole(WHITELISTED_ROLE, NEW_KEEPER));
  console.log('New keeper has role: ', await surplusConverter2.hasRole(WHITELISTED_ROLE, NEW_KEEPER));
}

main();
