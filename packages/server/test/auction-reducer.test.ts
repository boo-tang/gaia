import { describe, expect, it } from 'vitest';
import type { Address, AuctionStatus } from '@gaia/core';
import type { Hex } from 'viem';

import type { AuctionEvent } from '../src/indexer/auction-events';
import { reduceAuctionBlock, type AuctionBlockEvents } from '../src/indexer/auction-reducer';
import { MemoryAuctionStore } from '../src/store/memory-auction-store';

const ALICE: Address = '0x00000000000000000000000000000000000a11ce';
const BOB: Address = '0x0000000000000000000000000000000000000b0b';
const STATUS: AuctionStatus = { endTime: 1000, paused: false, cancelled: false };

const sq = (lat: number, lng: number) => lat * 65536 + lng;
const hash = (n: number, branch = 0): Hex => `0x${(n + branch * 1_000_000).toString(16).padStart(64, '0')}`;
// Row 10 and row 11, columns 10 to 13 (as in test/Gaia_Auction.ts).
const row = [10, 11, 12, 13].map((lng) => sq(10, lng));
const row11 = [10, 11, 12, 13].map((lng) => sq(11, lng));

// The events have the types of the decoded logs: uint256 values are bigint.
let nextLog = 0;
const bid = (shapeId: bigint, bidder: Address, squares: number[], amounts: bigint[], paid?: bigint): AuctionEvent => ({
  logIndex: nextLog++,
  eventName: 'ShapeBid',
  args: { shapeId, bidder, squares, amounts, paid: paid ?? amounts.reduce((a, b) => a + b, 0n) },
});
const each = (n: number, amount: bigint) => Array<bigint>(n).fill(amount);

const makeStore = () => new MemoryAuctionStore({ status: STATUS, undoDepth: 10 });

// Applies blocks 1, 2, 3 ... with these events, one block for each list.
const run = async (blocks: AuctionEvent[][], store = makeStore(), first = 1, branch = 0) => {
  for (const [i, events] of blocks.entries()) {
    const number = first + i;
    const block: AuctionBlockEvents = { block: { number, hash: hash(number, branch) }, timestamp: 100 + number, events };
    await store.applyBlock(await reduceAuctionBlock(store, block));
  }
  return store;
};

// The shape and amount of each square, and the held square count of each shape.
const state = async (store: MemoryAuctionStore, shapeIds: number[]) => {
  const squares = await store.squares([...row, ...row11]);
  const shapes = await store.shapes(shapeIds);
  return {
    squares: Object.fromEntries(squares.map((s) => [s.squareId, [s.shapeId, s.amount]])),
    held: Object.fromEntries(shapes.map((s) => [s.shapeId, s.heldSquareCount])),
  };
};

describe('reduceAuctionBlock', () => {
  it('makes a new shape and sets its squares', async () => {
    nextLog = 4;
    const store = await run([[bid(1n, ALICE, row, each(4, 1000n))]]);
    expect(await store.squares(row)).toEqual(row.map((squareId) => ({ squareId, shapeId: 1, amount: 1000n })));
    expect(await store.shapes([1])).toEqual([
      {
        shapeId: 1,
        bidder: ALICE,
        block: 1,
        timestamp: 101,
        bidSquareIds: row,
        heldSquareCount: 4,
        settlement: undefined,
      },
    ]);
    expect(await store.lastEventId()).toEqual({ block: 1, logIndex: 4 });
    expect(await store.messagesAfter(undefined)).toEqual([
      {
        type: 'shapeBid',
        id: { block: 1, logIndex: 4 },
        timestamp: 101,
        shapeId: 1,
        bidder: ALICE,
        squareIds: row,
        amounts: ['1000', '1000', '1000', '1000'],
        paid: '4000',
        taken: [],
      },
    ]);
  });

  it('moves the squares of a partial takeover and lowers the held count of the old shape', async () => {
    nextLog = 0;
    const store = await run([[bid(1n, ALICE, row, each(4, 1000n))], [bid(2n, BOB, [row[3]], [2000n])]]);
    expect(await state(store, [1, 2])).toEqual({
      squares: { [row[0]]: [1, 1000n], [row[1]]: [1, 1000n], [row[2]]: [1, 1000n], [row[3]]: [2, 2000n] },
      held: { 1: 3, 2: 1 },
    });
    const [, takeover] = await store.messagesAfter(undefined);
    expect(takeover).toMatchObject({ type: 'shapeBid', taken: [{ shapeId: 1, bidder: ALICE, squareIds: [row[3]] }] });
    expect((await store.bidder(ALICE)).shapes[0].heldSquareIds).toEqual(row.slice(0, 3));
    expect((await store.bidder(ALICE)).history).toHaveLength(2);
  });

  it('moves own squares to the new shape on a re-bid (merge of two shapes)', async () => {
    nextLog = 0;
    const store = await run([
      [bid(1n, ALICE, row.slice(0, 2), each(2, 1000n))],
      [bid(2n, ALICE, row.slice(2), each(2, 1000n))],
      // raiseOwnSquares = false: the amounts stay, and the bid pays nothing.
      [bid(3n, ALICE, row, each(4, 1000n), 0n)],
    ]);
    expect(await state(store, [1, 2, 3])).toEqual({
      squares: Object.fromEntries(row.map((id) => [id, [3, 1000n]])),
      held: { 1: 0, 2: 0, 3: 4 },
    });
    const merge = (await store.messagesAfter({ block: 2, logIndex: 1 }))[0];
    expect(merge).toMatchObject({
      paid: '0',
      taken: [
        { shapeId: 1, bidder: ALICE, squareIds: row.slice(0, 2) },
        { shapeId: 2, bidder: ALICE, squareIds: row.slice(2) },
      ],
    });
  });

  it('rebuilds the shapes and bids of the reference test in test/Gaia_Auction.ts', async () => {
    nextLog = 0;
    const store = await run([
      [bid(1n, ALICE, row, each(4, 1000n))],
      [bid(2n, BOB, [row[3]], [2000n])], // partial takeover
      [bid(3n, ALICE, row11, each(4, 1000n))],
      [bid(4n, ALICE, row, [1000n, 1000n, 1000n, 3000n], 3000n)], // take back; own squares stay
      [bid(5n, BOB, row11.slice(0, 2), each(2, 2000n))],
      [bid(6n, ALICE, [...row, ...row11.slice(2)], [2000n, 2000n, 2000n, 4000n, 2000n, 2000n], 6000n)], // merge and raise
      [bid(7n, BOB, [row[0]], [5000n])], // jump bid
    ]);
    expect(await state(store, [1, 2, 3, 4, 5, 6, 7])).toEqual({
      squares: {
        [row[0]]: [7, 5000n],
        [row[1]]: [6, 2000n],
        [row[2]]: [6, 2000n],
        [row[3]]: [6, 4000n],
        [row11[0]]: [5, 2000n],
        [row11[1]]: [5, 2000n],
        [row11[2]]: [6, 2000n],
        [row11[3]]: [6, 2000n],
      },
      held: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 2, 6: 5, 7: 1 },
    });
    const alice = await store.bidder(ALICE);
    expect(alice.shapes.map((s) => [s.shapeId, s.heldSquareIds])).toEqual([
      [1, []],
      [3, []],
      [4, []],
      [6, [...row.slice(1), ...row11.slice(2)]],
    ]);
  });

  it('applies two bids in one block in log order', async () => {
    nextLog = 0;
    const store = await run([[bid(1n, ALICE, row, each(4, 1000n)), bid(2n, BOB, [row[0]], [2000n])]]);
    expect(await state(store, [1, 2])).toMatchObject({ held: { 1: 3, 2: 1 } });
    expect(await store.lastEventId()).toEqual({ block: 1, logIndex: 1 });
  });

  it('sets the end time, pause, unpause and cancel', async () => {
    const store = await run([
      [{ logIndex: 0, eventName: 'AuctionExtended', args: { endTime: 1200n } }],
      [{ logIndex: 0, eventName: 'AuctionPaused', args: {} }],
      [{ logIndex: 0, eventName: 'AuctionUnpaused', args: {} }, { logIndex: 1, eventName: 'AuctionExtended', args: { endTime: 1300n } }],
      [{ logIndex: 0, eventName: 'AuctionPaused', args: {} }],
    ]);
    expect(await store.status()).toEqual({ endTime: 1300, paused: true, cancelled: false });
    const messages = await store.messagesAfter(undefined);
    expect(messages.map((m) => (m.type === 'auctionStatus' ? m.status : undefined))).toEqual([
      { endTime: 1200, paused: false, cancelled: false },
      { endTime: 1200, paused: true, cancelled: false },
      { endTime: 1200, paused: false, cancelled: false },
      { endTime: 1300, paused: false, cancelled: false },
      { endTime: 1300, paused: true, cancelled: false },
    ]);
  });

  it('keeps the bids after a cancel; the refunds come from the contract', async () => {
    nextLog = 0;
    const store = await run([
      [bid(1n, ALICE, row, each(4, 1000n))],
      [{ logIndex: 0, eventName: 'AuctionPaused', args: {} }],
      [{ logIndex: 0, eventName: 'AuctionCancelled', args: { by: BOB } }],
    ]);
    expect(await store.status()).toEqual({ endTime: 1000, paused: true, cancelled: true });
    // The bids stay as data: after a cancel, `withdraw` returns them (the API reads
    // `activeBids`). Nothing settles.
    expect(await store.squares(row)).toHaveLength(4);
  });

  it('adds the settlement chunks of a shape', async () => {
    nextLog = 0;
    const store = await run([
      [bid(1n, ALICE, [...row, ...row11], each(8, 1000n))],
      [{ logIndex: 0, eventName: 'ShapeSquaresSettled', args: { shapeId: 1n, countryId: 3n, count: 4n } }],
      [
        { logIndex: 0, eventName: 'ShapeSquaresSettled', args: { shapeId: 1n, countryId: 3n, count: 4n } },
        { logIndex: 1, eventName: 'ShapeSettled', args: { shapeId: 1n, countryId: 3n, winner: ALICE, totalSquares: 8n } },
      ],
    ]);
    const [shape] = (await store.bidder(ALICE)).shapes;
    expect(shape.settlement).toEqual({ countryId: 3, settledSquareCount: 8, done: true });
    const settlements = (await store.messagesAfter({ block: 1, logIndex: 0 })).map((m) =>
      m.type === 'settlement' ? [m.settlement, m.bidder] : undefined,
    );
    expect(settlements).toEqual([
      [{ countryId: 3, settledSquareCount: 4, done: false }, ALICE],
      [{ countryId: 3, settledSquareCount: 8, done: false }, ALICE],
      [{ countryId: 3, settledSquareCount: 8, done: true }, ALICE],
    ]);
  });

  it('gives the same state after a reorg as a replay of the new chain', async () => {
    nextLog = 0;
    const common = [[bid(1n, ALICE, row, each(4, 1000n))]];
    const lost = [[bid(2n, BOB, [row[3]], [2000n])], [bid(3n, BOB, row11, each(4, 1000n))]];
    const kept = [[bid(2n, ALICE, row11.slice(0, 2), each(2, 1000n))], [], [bid(3n, BOB, [row[0]], [2000n])]];

    const store = await run(common);
    await run(lost, store, 2);
    await store.undoAfter(1);
    await run(kept, store, 2, 1);

    const replay = await run([...common, ...kept], makeStore(), 1, 0);
    const ids = [1, 2, 3];
    expect(await state(store, ids)).toEqual(await state(replay, ids));
    expect(await store.lastEventId()).toEqual(await replay.lastEventId());
    expect(await store.messagesAfter(undefined)).toEqual(await replay.messagesAfter(undefined));
    expect((await store.lastBlock())?.hash).toBe(hash(4, 1));
  });

  it('rejects events out of log order, unknown shapes and IDs above 2^53', async () => {
    const store = makeStore();
    const block = { number: 1, hash: hash(1) };
    await expect(
      reduceAuctionBlock(store, {
        block,
        timestamp: 1,
        events: [
          { ...bid(1n, ALICE, row, each(4, 1000n)), logIndex: 2 },
          { ...bid(2n, BOB, [row[0]], [2000n]), logIndex: 1 },
        ],
      }),
    ).rejects.toThrow(/log order/);
    await expect(
      reduceAuctionBlock(store, {
        block,
        timestamp: 1,
        events: [{ logIndex: 0, eventName: 'ShapeSettled', args: { shapeId: 9n, countryId: 1n, winner: ALICE, totalSquares: 1n } }],
      }),
    ).rejects.toThrow(/Shape 9/);
    await expect(
      reduceAuctionBlock(store, { block, timestamp: 1, events: [{ ...bid(2n ** 53n, ALICE, row, each(4, 1000n)), logIndex: 0 }] }),
    ).rejects.toThrow(/too large/);
  });
});
