import { gaiaAuctionAbi } from '@gaia/core';

import {
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  HttpRequestError,
  UserRejectedRequestError,
  encodeErrorResult,
} from 'viem';
import { describe, expect, it } from 'vitest';

import { BID_ERROR_TEXTS } from '../src/bid/bid-flow';
import { describeTxError } from '../src/tx/tx-errors';

// The errors as viem gives them: a cause wrapped in `ContractFunctionExecutionError`.
const wrap = (cause: Error) =>
  new ContractFunctionExecutionError(cause as ContractFunctionRevertedError, {
    abi: gaiaAuctionAbi,
    functionName: 'bidOnShape',
    args: [],
  });

const revertWith = (data: `0x${string}`) =>
  wrap(new ContractFunctionRevertedError({ abi: gaiaAuctionAbi, data, functionName: 'bidOnShape' }));

const revert = (errorName: string, args?: readonly unknown[]) =>
  revertWith(encodeErrorResult({ abi: gaiaAuctionAbi, errorName, args } as Parameters<typeof encodeErrorResult>[0]));

const bidText = (error: unknown) => describeTxError(error, 'The bid failed', BID_ERROR_TEXTS);

describe('describeTxError', () => {
  it('has plain texts for the errors that bidders hit most', () => {
    expect(bidText(revert('InsufficientValue', [10n ** 18n, 3n * 10n ** 18n]))).toMatchObject({
      rejected: false,
      text: 'The prices changed. The bid now costs 3 ETH. Check the new total and bid again.',
    });
    expect(bidText(revert('OverlapWouldInvalidateShape', [7n]))).toMatchObject({
      text: 'The rest of shape 7 would break the shape rules. Change the selection where it meets shape 7, or take all of its squares.',
    });
    expect(bidText(revert('ShapeTooSmall', [2n, 4n]))).toMatchObject({
      text: 'Too few squares: a shape has at least 4 squares.',
    });
    expect(bidText(revert('AuctionIsPaused'))).toMatchObject({ text: 'The auction is paused. You cannot bid now.' });
    expect(bidText(revert('AuctionAlreadyEnded'))).toMatchObject({ text: 'The auction has ended.' });
  });

  it('shows the name of the other contract errors', () => {
    expect(bidText(revert('AspectRatioExceeded'))).toMatchObject({ text: 'The bid failed: AspectRatioExceeded.' });
    expect(bidText(revert('ShapeTooLarge', [300n, 200n]))).toMatchObject({ text: 'The bid failed: ShapeTooLarge.' });
  });

  it('shows the selector of an error that is not in the ABI', () => {
    expect(bidText(revertWith('0x12345678'))).toMatchObject({ text: 'The bid failed: unknown error (0x12345678).' });
  });

  it('sees a wallet rejection as no error', () => {
    expect(bidText(wrap(new UserRejectedRequestError(new Error('User denied.'))))).toEqual({ rejected: true });
    // Some wallets send only the EIP-1193 code.
    expect(bidText(Object.assign(new Error('Rejected'), { code: 4001 }))).toEqual({ rejected: true });
  });

  it('says when the chain cannot be reached', () => {
    const error = wrap(new HttpRequestError({ url: 'http://127.0.0.1:8545', details: 'fetch failed' }));
    expect(bidText(error)).toMatchObject({
      rejected: false,
      text: 'Cannot reach the chain. Check your connection and try again.',
    });
  });

  it('shows the first line of other errors', () => {
    expect(bidText(new Error('Something broke\nmore text'))).toEqual({
      rejected: false,
      text: 'The bid failed: Something broke',
    });
  });
});
