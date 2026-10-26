import {
  type Address,
  type AuctionStatus,
  type ShapeBidMessage,
  type StreamMessage,
  type Viewport,
  type ViewportSnapshot,
  packSquare,
} from '@gaia/core';

import { describe, expect, it } from 'vitest';

import { viewportContains, viewportHolds } from '../src/bids/areas';
import { type BidsAction, type BidsState, initialBidsState, reduceBids } from '../src/bids/bids-reducer';

const ALICE: Address = '0x00000000000000000000000000000000000000a1';
const BOB: Address = '0x00000000000000000000000000000000000000b2';
const OPEN: AuctionStatus = { endTime: 5000, paused: false, cancelled: false };

const sq = (lat: number, lng: number) => packSquare({ lat, lng });
const A = sq(100, 200);
const B = sq(100, 201);
const C = sq(101, 200);
const AREA: Viewport = { south: 90, north: 110, west: 190, east: 210 };

const snapshot = (block: number, bids: [number, number, Address, string][], viewport = AREA): ViewportSnapshot => ({
  lastEventId: { block, logIndex: 0 },
  viewport,
  status: OPEN,
  bids: bids.map(([squareId, shapeId, bidder, amount]) => ({ squareId, shapeId, bidder, amount })),
});

const shapeBid = (
  block: number,
  shapeId: number,
  bidder: Address,
  squares: [number, string][],
  taken: ShapeBidMessage['taken'] = [],
): StreamMessage => ({
  type: 'shapeBid',
  id: { block, logIndex: 0 },
  timestamp: 1000 + block,
  shapeId,
  bidder,
  squareIds: squares.map(([squareId]) => squareId),
  amounts: squares.map(([, amount]) => amount),
  paid: '0',
  taken,
});

/** The user's own bid from its receipt: the same event as `shapeBid` at that block. */
const receipt = (block: number, shapeId: number, bidder: Address, squares: [number, string][]): BidsAction => ({
  type: 'receipt',
  bid: {
    id: { block, logIndex: 0 },
    shapeId,
    bidder,
    squareIds: squares.map(([squareId]) => squareId),
    amounts: squares.map(([, amount]) => amount),
  },
});

const run = (...actions: BidsAction[]) => actions.reduce(reduceBids, initialBidsState());

const bidOf = (state: BidsState, squareId: number) => {
  const held = state.bids.get(squareId);
  return held && { shapeId: held.shapeId, bidder: held.bidder, amount: held.amount };
};

describe('reduceBids', () => {
  it('loads a snapshot', () => {
    const state = run({ type: 'snapshot', snapshot: snapshot(10, [[A, 1, ALICE, '100']]), reorgCount: 0 });
    expect(bidOf(state, A)).toEqual({ shapeId: 1, bidder: ALICE, amount: 100n });
    expect(state.snapshotAreas).toEqual([AREA]);
    expect(state.status).toEqual(OPEN);
    expect(state.bidsVersion).toBe(1);
  });

  it('applies a shapeBid message', () => {
    const state = run(
      { type: 'snapshot', snapshot: snapshot(10, []), reorgCount: 0 },
      {
        type: 'message',
        message: shapeBid(11, 1, ALICE, [
          [A, '100'],
          [B, '100'],
        ]),
      },
    );
    expect(bidOf(state, B)).toEqual({ shapeId: 1, bidder: ALICE, amount: 100n });
    expect(state.lastStreamEventId).toEqual({ block: 11, logIndex: 0 });
  });

  it('gives squares taken from another shape to the new shape', () => {
    const state = run(
      {
        type: 'message',
        message: shapeBid(11, 1, ALICE, [
          [A, '100'],
          [B, '100'],
        ]),
      },
      {
        type: 'message',
        message: shapeBid(
          12,
          2,
          BOB,
          [
            [B, '200'],
            [C, '100'],
          ],
          [{ shapeId: 1, bidder: ALICE, squareIds: [B] }],
        ),
      },
    );
    expect(bidOf(state, A)).toEqual({ shapeId: 1, bidder: ALICE, amount: 100n });
    expect(bidOf(state, B)).toEqual({ shapeId: 2, bidder: BOB, amount: 200n });
    expect(bidOf(state, C)).toEqual({ shapeId: 2, bidder: BOB, amount: 100n });
  });

  it('applies a re-bid on own squares', () => {
    const state = run(
      { type: 'message', message: shapeBid(11, 1, ALICE, [[A, '100']]) },
      {
        type: 'message',
        message: shapeBid(
          12,
          2,
          ALICE,
          [
            [A, '150'],
            [B, '100'],
          ],
          [{ shapeId: 1, bidder: ALICE, squareIds: [A] }],
        ),
      },
    );
    expect(bidOf(state, A)).toEqual({ shapeId: 2, bidder: ALICE, amount: 150n });
  });

  it('keeps a live bid when an older snapshot arrives after it', () => {
    const state = run(
      { type: 'message', message: shapeBid(12, 2, BOB, [[A, '200']]) },
      {
        type: 'snapshot',
        snapshot: snapshot(10, [
          [A, 1, ALICE, '100'],
          [B, 1, ALICE, '100'],
        ]),
        reorgCount: 0,
      },
    );
    expect(bidOf(state, A)).toEqual({ shapeId: 2, bidder: BOB, amount: 200n });
    expect(bidOf(state, B)).toEqual({ shapeId: 1, bidder: ALICE, amount: 100n });
  });

  it('keeps a snapshot when an older message arrives after it', () => {
    const state = run(
      { type: 'snapshot', snapshot: snapshot(12, [[A, 2, BOB, '200']]), reorgCount: 0 },
      { type: 'message', message: shapeBid(11, 1, ALICE, [[A, '100']]) },
    );
    expect(bidOf(state, A)).toEqual({ shapeId: 2, bidder: BOB, amount: 200n });
  });

  it('shows a bid from its receipt without moving the stream position', () => {
    const state = run(
      { type: 'message', message: shapeBid(5, 1, BOB, [[B, '50']]) },
      receipt(9, 2, ALICE, [[A, '100']]),
    );
    expect(bidOf(state, A)).toEqual({ shapeId: 2, bidder: ALICE, amount: 100n });
    expect(state.lastStreamEventId).toEqual({ block: 5, logIndex: 0 });
  });

  it('changes no bid when the stream sends the event of the receipt', () => {
    const before = run(receipt(9, 2, ALICE, [[A, '100']]));
    const { bidsVersion } = before;
    const after = reduceBids(before, { type: 'message', message: shapeBid(9, 2, ALICE, [[A, '100']]) });
    expect(after.bidsVersion).toBe(bidsVersion);
    expect(bidOf(after, A)).toEqual({ shapeId: 2, bidder: ALICE, amount: 100n });
    expect(after.lastStreamEventId).toEqual({ block: 9, logIndex: 0 });
  });

  it('keeps the receipt bid over older data and replaces it with a newer bid', () => {
    const state = run(
      receipt(9, 2, ALICE, [[A, '100']]),
      { type: 'message', message: shapeBid(8, 1, BOB, [[A, '90']]) },
      { type: 'snapshot', snapshot: snapshot(8, [[A, 1, BOB, '90']]), reorgCount: 0 },
    );
    expect(bidOf(state, A)).toEqual({ shapeId: 2, bidder: ALICE, amount: 100n });
    const outbid = reduceBids(state, { type: 'message', message: shapeBid(10, 3, BOB, [[A, '200']]) });
    expect(bidOf(outbid, A)).toEqual({ shapeId: 3, bidder: BOB, amount: 200n });
  });

  it('does not change the bidsVersion when nothing changes', () => {
    const first = run({ type: 'snapshot', snapshot: snapshot(12, [[A, 2, BOB, '200']]), reorgCount: 0 });
    const second = reduceBids(first, { type: 'snapshot', snapshot: snapshot(12, [[A, 2, BOB, '200']]), reorgCount: 0 });
    expect(second.bidsVersion).toBe(first.bidsVersion);
  });

  it('applies the newest auctionStatus', () => {
    const paused: AuctionStatus = { ...OPEN, paused: true };
    const extended: AuctionStatus = { ...OPEN, endTime: 6000 };
    const state = run(
      { type: 'snapshot', snapshot: snapshot(10, []), reorgCount: 0 },
      {
        type: 'message',
        message: { type: 'auctionStatus', id: { block: 12, logIndex: 0 }, timestamp: 1, status: paused },
      },
      {
        type: 'message',
        message: { type: 'auctionStatus', id: { block: 11, logIndex: 0 }, timestamp: 1, status: extended },
      },
      { type: 'snapshot', snapshot: { ...snapshot(9, []), status: extended }, reorgCount: 0 },
    );
    expect(state.status).toEqual(paused);
  });

  it('does not change the bids on a settlement', () => {
    const before = run({ type: 'message', message: shapeBid(11, 1, ALICE, [[A, '100']]) });
    const bidsVersion = before.bidsVersion;
    const state = reduceBids(before, {
      type: 'message',
      message: {
        type: 'settlement',
        id: { block: 20, logIndex: 0 },
        timestamp: 1,
        shapeId: 1,
        bidder: ALICE,
        settlement: { countryId: 1, settledSquareCount: 1, done: true },
      },
    });
    expect(bidOf(state, A)).toEqual({ shapeId: 1, bidder: ALICE, amount: 100n });
    expect(state.bidsVersion).toBe(bidsVersion);
    expect(state.lastStreamEventId).toEqual({ block: 20, logIndex: 0 });
  });

  it('removes all data on a reorg and ignores snapshots from before it', () => {
    const state = run(
      { type: 'snapshot', snapshot: snapshot(10, [[A, 1, ALICE, '100']]), reorgCount: 0 },
      { type: 'message', message: { type: 'reorg', lastEventId: { block: 8, logIndex: 0 } } },
      { type: 'snapshot', snapshot: snapshot(10, [[B, 1, ALICE, '100']]), reorgCount: 0 },
    );
    expect(state.bids.size).toBe(0);
    expect(state.snapshotAreas).toEqual([]);
    expect(state.status).toBeUndefined();
    expect(state.reorgCount).toBe(1);
    expect(state.lastStreamEventId).toEqual({ block: 8, logIndex: 0 });

    const after = reduceBids(state, { type: 'snapshot', snapshot: snapshot(8, [[C, 1, BOB, '100']]), reorgCount: 1 });
    expect(bidOf(after, C)).toEqual({ shapeId: 1, bidder: BOB, amount: 100n });
  });

  it('keeps one area for areas inside a larger one', () => {
    const small: Viewport = { south: 95, north: 100, west: 195, east: 200 };
    const state = run(
      { type: 'snapshot', snapshot: snapshot(10, [], small), reorgCount: 0 },
      { type: 'snapshot', snapshot: snapshot(11, []), reorgCount: 0 },
      { type: 'snapshot', snapshot: snapshot(12, [], small), reorgCount: 0 },
    );
    expect(state.snapshotAreas).toEqual([AREA]);
  });

  it('evicts the bids and the areas outside an area', () => {
    const far: Viewport = { south: 5000, north: 5010, west: 0, east: 10 };
    const state = run(
      { type: 'snapshot', snapshot: snapshot(10, [[A, 1, ALICE, '100']]), reorgCount: 0 },
      { type: 'snapshot', snapshot: snapshot(10, [[sq(5000, 5), 2, BOB, '100']], far), reorgCount: 0 },
      { type: 'evict', keep: far },
    );
    expect([...state.bids.keys()]).toEqual([sq(5000, 5)]);
    expect(state.snapshotAreas).toEqual([far]);
  });
});

describe('grid areas', () => {
  const across: Viewport = { south: 0, north: 10, west: 35990, east: 9 };

  it('finds a square in an area across the antimeridian', () => {
    expect(viewportHolds(across, sq(5, 35995))).toBe(true);
    expect(viewportHolds(across, sq(5, 3))).toBe(true);
    expect(viewportHolds(across, sq(5, 100))).toBe(false);
    expect(viewportHolds(across, sq(11, 3))).toBe(false);
  });

  it('finds an area inside another one', () => {
    expect(viewportContains(across, { south: 2, north: 8, west: 35995, east: 2 })).toBe(true);
    expect(viewportContains(across, { south: 2, north: 8, west: 0, east: 9 })).toBe(true);
    expect(viewportContains(across, { south: 2, north: 8, west: 35980, east: 2 })).toBe(false);
    expect(viewportContains({ south: 0, north: 10, west: 0, east: 35999 }, across)).toBe(true);
    expect(viewportContains(AREA, across)).toBe(false);
  });
});
