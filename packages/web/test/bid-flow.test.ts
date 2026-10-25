import { gaiaAuctionAbi } from '@gaia/core';

import { type Address, type Hash, type Log, encodeAbiParameters, encodeEventTopics } from 'viem';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  type BidCall,
  type BidCalls,
  bidDisabledReason,
  bidFlow,
  bidSteps,
  paidFromReceipt,
} from '../src/bid/bid-flow';
import { selectionStore } from '../src/selection/useSelection';
import { runTx } from '../src/tx/tx-flow';

const ALICE: Address = '0x00000000000000000000000000000000000000a1';
const BOB: Address = '0x00000000000000000000000000000000000000b2';
const HASH: Hash = `0x${'cd'.repeat(32)}`;

/** A `ShapeBid` log as the receipt has it. */
const shapeBidLog = (bidder: Address, paid: bigint): Log =>
  ({
    address: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
    topics: encodeEventTopics({ abi: gaiaAuctionAbi, eventName: 'ShapeBid', args: { shapeId: 4n, bidder } }),
    data: encodeAbiParameters(
      [{ type: 'uint32[]' }, { type: 'uint256[]' }, { type: 'uint256' }],
      [[65_536], [paid], paid],
    ),
  }) as unknown as Log;

const CALL: BidCall = { bidder: ALICE, packed: [65_536], floorPerSquare: 0n, value: 7n };

const calls = (paid = 7n): BidCalls => ({
  simulate: vi.fn(() => Promise.resolve()),
  write: vi.fn(() => Promise.resolve(HASH)),
  waitForReceipt: vi.fn(() => Promise.resolve({ status: 'success' as const, logs: [shapeBidLog(ALICE, paid)] })),
});

afterEach(() => {
  selectionStore.clear();
  bidFlow.set({ status: 'idle' });
});

describe('bidDisabledReason', () => {
  const open = { auction: 'open', connected: true, rightChain: true, chainName: 'Anvil' } as const;

  it('allows the bid only while the auction is open, with a wallet on the chain of the app', () => {
    expect(bidDisabledReason(open)).toBeUndefined();
    for (const auction of ['loading', 'unavailable', 'notStarted', 'paused', 'cancelled', 'ended'] as const) {
      expect(bidDisabledReason({ ...open, auction }), auction).toBeDefined();
    }
    expect(bidDisabledReason({ ...open, connected: false })).toBeDefined();
    expect(bidDisabledReason({ ...open, rightChain: false })).toBeDefined();
  });
});

describe('paidFromReceipt', () => {
  it('reads paid of the ShapeBid event of the bidder', () => {
    const receipt = { status: 'success' as const, logs: [shapeBidLog(BOB, 3n), shapeBidLog(ALICE, 9n)] };
    expect(paidFromReceipt(receipt, ALICE)).toBe(9n);
    expect(paidFromReceipt({ status: 'success', logs: [] }, ALICE)).toBeUndefined();
  });
});

describe('bidSteps', () => {
  it('sends the call, shows paid and clears the selection after the receipt', async () => {
    selectionStore.addSquares([{ lat: 1, lng: 0 }]);
    const fakes = calls(6n);
    const onDone = vi.fn();
    await runTx(bidFlow, bidSteps(CALL, fakes, onDone));
    expect(fakes.simulate).toHaveBeenCalledWith(CALL);
    expect(fakes.write).toHaveBeenCalledWith(CALL);
    expect(bidFlow.getState()).toEqual({ status: 'done', hash: HASH, result: 6n });
    expect(selectionStore.getState().squareIds.size).toBe(0);
    expect(onDone).toHaveBeenCalledWith(6n);
    // "Bid placed" stays until the user selects squares again.
    selectionStore.addSquares([{ lat: 2, lng: 0 }]);
    expect(bidFlow.getState().status).toBe('idle');
  });

  it('keeps a selection that changed during the bid', async () => {
    selectionStore.addSquares([{ lat: 1, lng: 0 }]);
    const fakes = calls();
    fakes.write = vi.fn(() => {
      selectionStore.addSquares([{ lat: 1, lng: 1 }]);
      return Promise.resolve(HASH);
    });
    await runTx(bidFlow, bidSteps(CALL, fakes));
    expect(bidFlow.getState().status).toBe('done');
    expect(selectionStore.getState().squareIds.size).toBe(2);
  });

  it('keeps the selection after a revert, and hides the error when the selection changes', async () => {
    selectionStore.addSquares([{ lat: 1, lng: 0 }]);
    const fakes = calls();
    fakes.simulate = vi.fn(() => Promise.reject(new Error('reverted')));
    await runTx(bidFlow, bidSteps(CALL, fakes));
    expect(bidFlow.getState().status).toBe('failed');
    expect(selectionStore.getState().squareIds.size).toBe(1);
    selectionStore.toggle({ lat: 1, lng: 0 });
    expect(bidFlow.getState().status).toBe('idle');
  });
});
