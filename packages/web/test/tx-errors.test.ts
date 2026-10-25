import { gaiaAuctionAbi } from '@gaia/core';

import { ContractFunctionExecutionError, type ContractFunctionRevertedError, UserRejectedRequestError } from 'viem';
import { describe, expect, it } from 'vitest';

import { BID_ERROR_TEXTS } from '../src/bid/bid-flow';
import { describeTxError } from '../src/tx/tx-errors';

// The error as viem gives it: a cause wrapped in `ContractFunctionExecutionError`.
const wrap = (cause: Error) =>
  new ContractFunctionExecutionError(cause as ContractFunctionRevertedError, {
    abi: gaiaAuctionAbi,
    functionName: 'bidOnShape',
    args: [],
  });

const bidText = (error: unknown) => describeTxError(error, 'The bid failed', BID_ERROR_TEXTS);

describe('describeTxError', () => {
  it('sees a wallet rejection as no error', () => {
    expect(bidText(wrap(new UserRejectedRequestError(new Error('User denied.'))))).toEqual({ rejected: true });
    // Some wallets send only the EIP-1193 code.
    expect(bidText(Object.assign(new Error('Rejected'), { code: 4001 }))).toEqual({ rejected: true });
  });

  it('is not a rejection for other errors', () => {
    expect(bidText(new Error('Something broke'))).toMatchObject({ rejected: false });
  });
});
