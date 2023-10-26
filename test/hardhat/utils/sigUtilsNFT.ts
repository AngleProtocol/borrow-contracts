import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { TypedDataUtils } from 'eth-sig-util';
import { fromRpcSig } from 'ethereumjs-util';
import { config } from 'hardhat';

export type TypePermitNFT = {
  contract: string;
  owner: string;
  spender: string;
  approved: boolean;
  deadline: number;
  v: number;
  r: Buffer;
  s: Buffer;
};

const EIP712Domain = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' },
];

const Permit = [
  { name: 'owner', type: 'address' },
  { name: 'spender', type: 'address' },
  { name: 'approved', type: 'bool' },
  { name: 'nonce', type: 'uint256' },
  { name: 'deadline', type: 'uint256' },
];

export async function domainSeparator(
  name: string,
  verifyingContract: string,
  version = '1',
  chainId?: number,
): Promise<string> {
  if (!chainId) {
    chainId = config.networks.hardhat.chainId;
  }

  return (
    '0x' +
    TypedDataUtils.hashStruct('EIP712Domain', { name, version, chainId, verifyingContract }, { EIP712Domain }).toString(
      'hex',
    )
  );
}

const buildDataNFT = (
  owner: string,
  chainId: number,
  verifyingContract: string,
  deadline: number,
  spender: string,
  nonce: number,
  approved: boolean,
  name: string,
  version: string,
) => ({
  primaryType: 'Permit',
  types: { Permit },
  domain: { name, version, chainId, verifyingContract },
  message: { owner, spender, approved, nonce, deadline },
});

export async function signPermitNFT(
  owner: SignerWithAddress,
  nonce: number,
  verifyingContract: string,
  deadline: number,
  spender: string,
  approved: boolean,
  name: string,
  chainId?: number,
  version = '1',
): Promise<TypePermitNFT> {
  if (!chainId) {
    chainId = config.networks.hardhat.chainId;
  }

  const data = buildDataNFT(
    owner.address,
    chainId,
    verifyingContract,
    deadline,
    spender,
    nonce,
    approved,
    name,
    version,
  );
  const signature = await owner._signTypedData(data.domain, data.types, data.message);
  const { v, r, s } = fromRpcSig(signature);

  return {
    contract: verifyingContract,
    owner: owner.address,
    spender: spender,
    approved: approved,
    deadline: deadline,
    v: v,
    r: r,
    s: s,
  };
}
