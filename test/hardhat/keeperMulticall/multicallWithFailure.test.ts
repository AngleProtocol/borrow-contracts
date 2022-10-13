import { ethers } from 'hardhat';

import { MockAnything, MultiCallWithFailure } from '../../../typechain';
import { expect } from '../utils/chai-setup';

describe('MulticallWithFailure', async () => {
  let multiCallWithFailure: MultiCallWithFailure;
  let mockAnything: MockAnything;

  beforeEach(async () => {
    multiCallWithFailure = (await (
      await ethers.getContractFactory('MultiCallWithFailure')
    ).deploy()) as MultiCallWithFailure;
    mockAnything = (await (await ethers.getContractFactory('MockAnything')).deploy()) as MockAnything;
  });

  it('multicall - fail: subcalls are not allowed to fail', async () => {
    await expect(
      multiCallWithFailure.multiCall([
        {
          target: mockAnything.address,
          data: mockAnything.interface.encodeFunctionData('fail', [5]),
          canFail: false,
        },
        {
          target: mockAnything.address,
          data: mockAnything.interface.encodeFunctionData('fail', [2]),
          canFail: true,
        },
      ]),
    ).to.be.revertedWith('SubcallFailed()');
  });

  it('multicall - success: subcalls are allowed to fail', async () => {
    const _results = await multiCallWithFailure.multiCall([
      {
        target: mockAnything.address,
        data: mockAnything.interface.encodeFunctionData('fail', [5]),
        canFail: true,
      },
      {
        target: mockAnything.address,
        data: mockAnything.interface.encodeFunctionData('fail', [2]),
        canFail: true,
      },
      {
        target: mockAnything.address,
        data: mockAnything.interface.encodeFunctionData('fail', [22]),
        canFail: false,
      },
      {
        target: mockAnything.address,
        data: mockAnything.interface.encodeFunctionData('fail', [15]),
        canFail: true,
      },
    ]);

    const results = _results.map(_data => {
      try {
        return mockAnything.interface.decodeFunctionResult('fail', _data);
      } catch (e) {
        try {
          return mockAnything.interface.parseError(_data).signature;
        } catch (e) { }
      }
      return undefined;
    });

    expect(results[0]).to.equal('CustomError()');
    expect(results[2]![0]).to.equal(23);
    expect(results[3]).to.equal('CustomErrorWithValue(uint256)');
  });

  it('multicall - fail: modify state', async () => {
    expect(await mockAnything.stateVar()).to.equal(1);

    await expect(
      multiCallWithFailure.multiCall([
        {
          target: mockAnything.address,
          data: mockAnything.interface.encodeFunctionData('modifyState', [5]),
          canFail: false,
        },
      ]),
    ).to.be.revertedWith('SubcallFailed()');

    expect(await mockAnything.stateVar()).to.equal(1);
  });

  it('multicall - success: modify state -> canFail true', async () => {
    expect(await mockAnything.stateVar()).to.equal(1);

    const _results = await multiCallWithFailure.multiCall([
      {
        target: mockAnything.address,
        data: mockAnything.interface.encodeFunctionData('modifyState', [5]),
        canFail: true,
      },
    ]);

    expect(await mockAnything.stateVar()).to.equal(1);
    expect(_results[0]).to.equal('0x');
  });
});
