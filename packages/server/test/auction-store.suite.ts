// The test suite of the AuctionStore interface. Each implementation runs it:
//
//   auctionStoreSuite('MemoryAuctionStore', (options) => new MemoryAuctionStore(options));
//
// A test gives the store the changes of a block directly (no reducer), and reads them back.

import { describe, expect, it } from 'vitest';
import type { Address, AuctionStatus, StreamMessage } from '@gaia/core';
import type { Hex } from 'viem';

import {
  UndoWindowExceededError,
  type AuctionStore,
  type AuctionBlockChanges,
  type StoredShape,
  type StoredSquareBid,
} from '../src/store/auction-store';

export interface AuctionStoreOptions {
  status: AuctionStatus;
  undoDepth: number;
}

const ALICE: Address = '0x00000000000000000000000000000000000a11ce';
const BOB: Address = '0x0000000000000000000000000000000000000b0b';
const STATUS: AuctionStatus = { endTime: 1000, paused: false, cancelled: false };
const WORLD = { south: 0, north: 17999, west: 0, east: 35999 };

const sq = (lat: number, lng: number) => lat * 65536 + lng;
const hash = (n: number): Hex => `0x${n.toString(16).padStart(64, '0')}`;
const square = (squareId: number, shapeId: number, amount: bigint): StoredSquareBid => ({ squareId, shapeId, amount });

const shape = (shapeId: number, bidder: Address, block: number, bidSquareIds: number[], held = bidSquareIds.length): StoredShape => ({
  shapeId,
  bidder,
  block,
  timestamp: block * 2,
  bidSquareIds,
  heldSquareCount: held,
  settlement: undefined,
});

const bidMessage = (
  block: number,
  logIndex: number,
  shapeId: number,
  bidder: Address,
  squareIds: number[],
  taken: { shapeId: number; bidder: Address; squareIds: number[] }[] = [],
): StreamMessage => ({
  type: 'shapeBid',
  id: { block, logIndex },
  timestamp: block * 2,
  shapeId,
  bidder,
  squareIds,
  amounts: squareIds.map(() => '100'),
  paid: (100 * squareIds.length).toString(),
  taken,
});

const statusMessage = (block: number, logIndex: number, status: AuctionStatus): StreamMessage => ({
  type: 'auctionStatus',
  id: { block, logIndex },
  timestamp: block * 2,
  status,
});

const empty = (block: number): AuctionBlockChanges => ({
  block: { number: block, hash: hash(block) },
  squares: [],
  shapes: [],
  status: undefined,
  messages: [],
});

// Alice bids on two squares in block 10 (shape 1). Bob takes one of them in block 12 (shape 2),
// and the soft close moves the end. Block 11 has no event.
const row = [sq(100, 5), sq(100, 6)];
const block10: AuctionBlockChanges = {
  ...empty(10),
  squares: row.map((id) => square(id, 1, 100n)),
  shapes: [shape(1, ALICE, 10, row)],
  messages: [bidMessage(10, 3, 1, ALICE, row)],
};
const block12: AuctionBlockChanges = {
  ...empty(12),
  squares: [square(row[1], 2, 200n)],
  shapes: [shape(1, ALICE, 10, row, 1), shape(2, BOB, 12, [row[1]])],
  status: { ...STATUS, endTime: 1500 },
  messages: [
    bidMessage(12, 0, 2, BOB, [row[1]], [{ shapeId: 1, bidder: ALICE, squareIds: [row[1]] }]),
    statusMessage(12, 1, { ...STATUS, endTime: 1500 }),
  ],
};

export const auctionStoreSuite = (name: string, makeStore: (options: AuctionStoreOptions) => AuctionStore) => {
  const make = (undoDepth = 10) => makeStore({ status: STATUS, undoDepth });
  const withBlocks = async (undoDepth = 10) => {
    const store = make(undoDepth);
    await store.applyBlock(block10);
    await store.applyBlock(empty(11));
    await store.applyBlock(block12);
    return store;
  };

  describe(`AuctionStore: ${name}`, () => {
    it('starts with no event, no block and the deployment status', async () => {
      const store = make();
      expect(await store.lastEventId()).toBeUndefined();
      expect(await store.lastBlock()).toBeUndefined();
      expect(await store.recentBlocks()).toEqual([]);
      expect(await store.status()).toEqual(STATUS);
      expect(await store.squares(row)).toEqual([]);
      expect(await store.shapes([1])).toEqual([]);
      expect(await store.messagesAfter(undefined)).toEqual([]);
      expect(await store.bidsInViewport(WORLD, 10)).toEqual({ lastEventId: undefined, bids: [], complete: true });
      expect(await store.bidder(ALICE)).toEqual({ lastEventId: undefined, bidder: ALICE, shapes: [], history: [] });
    });

    it('applies the squares, shapes, status, messages and block of a block', async () => {
      const store = await withBlocks();
      expect(await store.lastEventId()).toEqual({ block: 12, logIndex: 1 });
      expect(await store.lastBlock()).toEqual({ number: 12, hash: hash(12) });
      expect(await store.recentBlocks()).toEqual([12, 11, 10].map((n) => ({ number: n, hash: hash(n) })));
      expect(await store.status()).toEqual({ ...STATUS, endTime: 1500 });
      expect(await store.squares([...row, sq(1, 1)])).toEqual([square(row[0], 1, 100n), square(row[1], 2, 200n)]);
      expect(await store.shapes([2, 1, 3])).toEqual([shape(2, BOB, 12, [row[1]]), shape(1, ALICE, 10, row, 1)]);
      expect(await store.messagesAfter(undefined)).toEqual([...block10.messages, ...block12.messages]);
    });

    it('keeps the last event ID after a block with no event', async () => {
      const store = make();
      await store.applyBlock(block10);
      await store.applyBlock(empty(11));
      expect(await store.lastEventId()).toEqual({ block: 10, logIndex: 3 });
      expect(await store.lastBlock()).toEqual({ number: 11, hash: hash(11) });
    });

    it('rejects a block that is not after the last block', async () => {
      const store = await withBlocks();
      await expect(store.applyBlock(empty(12))).rejects.toThrow();
      await expect(store.applyBlock(empty(5))).rejects.toThrow();
      expect(await store.lastBlock()).toEqual({ number: 12, hash: hash(12) });
    });

    it('returns the bids in a viewport, with the bidder of the shape', async () => {
      const store = await withBlocks();
      const all = await store.bidsInViewport({ south: 100, north: 100, west: 5, east: 6 }, 10);
      expect(all.lastEventId).toEqual({ block: 12, logIndex: 1 });
      expect(all.complete).toBe(true);
      expect(all.bids.sort((a, b) => a.squareId - b.squareId)).toEqual([
        { squareId: row[0], shapeId: 1, bidder: ALICE, amount: '100' },
        { squareId: row[1], shapeId: 2, bidder: BOB, amount: '200' },
      ]);
      // The edges are included; other rows and columns are not.
      expect((await store.bidsInViewport({ south: 101, north: 200, west: 0, east: 35999 }, 10)).bids).toEqual([]);
      expect((await store.bidsInViewport({ south: 0, north: 99, west: 0, east: 35999 }, 10)).bids).toEqual([]);
      expect((await store.bidsInViewport({ south: 100, north: 100, west: 6, east: 6 }, 10)).bids).toHaveLength(1);
      expect((await store.bidsInViewport({ south: 100, north: 100, west: 7, east: 100 }, 10)).bids).toEqual([]);
    });

    it('wraps a viewport at the antimeridian', async () => {
      const store = make();
      const ids = [sq(50, 35999), sq(50, 0), sq(50, 1), sq(50, 18000)];
      await store.applyBlock({ ...empty(10), squares: ids.map((id) => square(id, 1, 1n)), shapes: [shape(1, ALICE, 10, ids)] });
      const { bids } = await store.bidsInViewport({ south: 0, north: 17999, west: 35990, east: 1 }, 10);
      expect(bids.map((b) => b.squareId).sort((a, b) => a - b)).toEqual([sq(50, 0), sq(50, 1), sq(50, 35999)]);
    });

    it('returns at most `limit` bids and says when the viewport has more', async () => {
      const store = await withBlocks();
      const one = await store.bidsInViewport(WORLD, 1);
      expect(one.bids).toHaveLength(1);
      expect(one.complete).toBe(false);
      expect((await store.bidsInViewport(WORLD, 2)).complete).toBe(true);
    });

    it('returns the shapes and the history of a bidder', async () => {
      const store = await withBlocks();
      const alice = await store.bidder(ALICE);
      expect(alice.lastEventId).toEqual({ block: 12, logIndex: 1 });
      expect(alice.shapes).toEqual([
        {
          shapeId: 1,
          bidder: ALICE,
          block: 10,
          timestamp: 20,
          bidSquareIds: row,
          heldSquareIds: [row[0]],
          settlement: undefined,
        },
      ]);
      // Her bid, and Bob's bid that took a square from her. No status messages.
      expect(alice.history).toEqual([block10.messages[0], block12.messages[0]]);
      // The address is not case-sensitive.
      expect((await store.bidder(BOB.toUpperCase().replace('0X', '0x') as Address)).shapes.map((s) => s.shapeId)).toEqual([2]);
      expect((await store.bidder(BOB)).history).toEqual([block12.messages[0]]);
    });

    it('returns the settlement of a shape in the bidder view', async () => {
      const store = await withBlocks();
      const settlement = { countryId: 7, settledSquareCount: 1, done: true };
      await store.applyBlock({ ...empty(13), shapes: [{ ...shape(2, BOB, 12, [row[1]]), settlement }] });
      const [bobShape] = (await store.bidder(BOB)).shapes;
      expect(bobShape.settlement).toEqual(settlement);
    });

    it('returns the messages after an event, with a bidder filter', async () => {
      const store = await withBlocks();
      expect(await store.messagesAfter({ block: 10, logIndex: 3 })).toEqual(block12.messages);
      expect(await store.messagesAfter({ block: 10, logIndex: 2 })).toHaveLength(3);
      expect(await store.messagesAfter({ block: 11, logIndex: 0 })).toEqual(block12.messages);
      expect(await store.messagesAfter({ block: 12, logIndex: 0 })).toEqual([block12.messages[1]]);
      expect(await store.messagesAfter({ block: 12, logIndex: 1 })).toEqual([]);
      // Bob: his bid and the status message, not Alice's first bid.
      expect(await store.messagesAfter(undefined, { bidder: BOB })).toEqual(block12.messages);
      const carol: Address = '0x0000000000000000000000000000000000000c0c';
      expect(await store.messagesAfter(undefined, { bidder: carol })).toEqual([block12.messages[1]]);
    });

    it('undoes the blocks after a block', async () => {
      const store = await withBlocks();
      await store.undoAfter(10);
      expect(await store.lastEventId()).toEqual({ block: 10, logIndex: 3 });
      expect(await store.lastBlock()).toEqual({ number: 10, hash: hash(10) });
      expect(await store.recentBlocks()).toEqual([{ number: 10, hash: hash(10) }]);
      expect(await store.status()).toEqual(STATUS);
      expect(await store.squares(row)).toEqual(row.map((id) => square(id, 1, 100n)));
      expect(await store.shapes([1, 2])).toEqual([shape(1, ALICE, 10, row)]);
      expect(await store.messagesAfter(undefined)).toEqual(block10.messages);
      expect((await store.bidder(BOB)).shapes).toEqual([]);
      expect((await store.bidder(ALICE)).shapes[0].heldSquareIds).toEqual(row);

      // The chain continues on the new branch.
      await store.applyBlock({ ...empty(11), block: { number: 11, hash: hash(111) } });
      expect(await store.lastBlock()).toEqual({ number: 11, hash: hash(111) });

      // Undo of everything: back to the start.
      await store.undoAfter(0);
      expect(await store.lastEventId()).toBeUndefined();
      expect(await store.lastBlock()).toBeUndefined();
      expect(await store.squares(row)).toEqual([]);
      expect((await store.bidsInViewport(WORLD, 10)).bids).toEqual([]);
    });

    it('does nothing when no block is after the given block', async () => {
      const store = await withBlocks();
      await store.undoAfter(12);
      await store.undoAfter(50);
      expect(await store.lastEventId()).toEqual({ block: 12, logIndex: 1 });
      expect(await store.recentBlocks()).toHaveLength(3);
    });

    it('cannot undo a block that left the undo window', async () => {
      const store = await withBlocks(2);
      expect((await store.recentBlocks()).map((b) => b.number)).toEqual([12, 11]);
      await expect(store.undoAfter(9)).rejects.toThrow(UndoWindowExceededError);
      // Nothing changed.
      expect(await store.lastEventId()).toEqual({ block: 12, logIndex: 1 });
      expect(await store.recentBlocks()).toHaveLength(2);
      // The blocks in the window can be undone.
      await store.undoAfter(10);
      expect(await store.lastBlock()).toEqual({ number: 10, hash: hash(10) });
      expect(await store.lastEventId()).toEqual({ block: 10, logIndex: 3 });
      expect(await store.squares(row)).toEqual(row.map((id) => square(id, 1, 100n)));
    });

    it('goes back to no data with reset', async () => {
      const store = await withBlocks();
      await store.reset();
      expect(await store.lastEventId()).toBeUndefined();
      expect(await store.lastBlock()).toBeUndefined();
      expect(await store.status()).toEqual(STATUS);
      expect(await store.squares(row)).toEqual([]);
      expect(await store.messagesAfter(undefined)).toEqual([]);
      expect((await store.bidder(ALICE)).shapes).toEqual([]);
      await store.applyBlock(block10);
      expect(await store.lastEventId()).toEqual({ block: 10, logIndex: 3 });
    });
  });
};
