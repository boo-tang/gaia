import { afterEach, describe, expect, it } from 'vitest';
import type { Address, AuctionRules, AuctionStatus, BidderView, StreamMessage } from '@gaia/core';
import type { Hex } from 'viem';

import { createHttpApi } from '../src/api/http-api';
import type { AuctionEvent } from '../src/indexer/auction-events';
import { reduceAuctionBlock } from '../src/indexer/auction-reducer';
import { LiveMessageBus } from '../src/live-message-bus';
import { MemoryAuctionStore } from '../src/store/memory-auction-store';
import { SseReader } from './sse-reader';

const ALICE: Address = '0x00000000000000000000000000000000000A11cE';
const BOB: Address = '0x0000000000000000000000000000000000000B0b';
const STATUS: AuctionStatus = { endTime: 1000, paused: false, cancelled: false };
const RULES: AuctionRules = {
  chainId: 31337,
  auction: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
  startTime: 0,
  maxEndTime: 2000,
  extensionWindow: 900,
  minBidPerSquareWei: '1000',
  minBidIncrementBps: 500,
  minShapeSquares: 1,
  maxShapeSquares: 200,
  maxShapeAspectRatio: 10,
};
const sq = (lat: number, lng: number) => lat * 65536 + lng;
const hash = (n: number): Hex => `0x${n.toString(16).padStart(64, '0')}`;
const bid = (logIndex: number, shapeId: bigint, bidder: Address, squares: number[], amount: bigint): AuctionEvent => ({
  logIndex,
  eventName: 'ShapeBid',
  args: { shapeId, bidder, squares, amounts: squares.map(() => amount), paid: amount * BigInt(squares.length) },
});

const setup = async () => {
  const store = new MemoryAuctionStore({ status: STATUS, undoDepth: 10 });
  const liveMessageBus = new LiveMessageBus();
  const refunds: [Address, boolean][] = [];
  const app = createHttpApi({
    store,
    liveMessageBus,
    rules: RULES,
    refundOf: async (bidder, cancelled) => {
      refunds.push([bidder, cancelled]);
      return 42n;
    },
    maxSnapshotBids: 3,
    heartbeatMs: 50,
  });
  // As the indexer: apply a block, then publish its messages.
  const apply = async (number: number, events: AuctionEvent[]) => {
    const changes = await reduceAuctionBlock(store, { block: { number, hash: hash(number) }, timestamp: 100 + number, events });
    await store.applyBlock(changes);
    liveMessageBus.publish(changes.messages);
  };
  return { store, liveMessageBus, app, apply, refunds };
};

const readers: SseReader[] = [];
const open = async (app: Awaited<ReturnType<typeof setup>>['app'], path: string, headers: Record<string, string> = {}) => {
  const response = await app.request(path, { headers });
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toMatch(/text\/event-stream/);
  const reader = new SseReader(response);
  readers.push(reader);
  return reader;
};
afterEach(async () => {
  await Promise.all(readers.splice(0).map((r) => r.close()));
});

describe('API', () => {
  it('GET /auction returns the rules, the status and the last event ID', async () => {
    const { app, apply } = await setup();
    await apply(5, [{ logIndex: 2, eventName: 'AuctionExtended', args: { endTime: 1500n } }]);
    const response = await app.request('/auction');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      lastEventId: { block: 5, logIndex: 2 },
      rules: RULES,
      status: { ...STATUS, endTime: 1500 },
    });
  });

  it('GET /bids returns the bids in a viewport, also across the antimeridian', async () => {
    const { app, apply } = await setup();
    await apply(5, [bid(0, 1n, ALICE, [sq(100, 35999), sq(100, 0)], 1000n), bid(1, 2n, BOB, [sq(100, 500)], 2000n)]);

    const response = await app.request('/bids?south=90&north=110&west=35990&east=10');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.lastEventId).toEqual({ block: 5, logIndex: 1 });
    expect(body.viewport).toEqual({ south: 90, north: 110, west: 35990, east: 10 });
    expect(body.status).toEqual(STATUS);
    expect(body.bids.map((b: { squareId: number }) => b.squareId).sort()).toEqual([sq(100, 0), sq(100, 35999)].sort());
    expect(body.bids[0]).toMatchObject({ shapeId: 1, bidder: ALICE, amount: '1000' });
  });

  it('GET /bids answers 400 for a viewport with too many bids', async () => {
    const { app, apply } = await setup();
    await apply(5, [bid(0, 1n, ALICE, [1, 2, 3, 4].map((lng) => sq(100, lng)), 1000n)]);
    const response = await app.request('/bids?south=0&north=17999&west=0&east=35999');
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/more than 3 bids\. Zoom in/);
  });

  it('GET /bids checks the input', async () => {
    const { app } = await setup();
    for (const query of [
      '',
      'south=1&north=2&west=3',
      'south=-1&north=2&west=3&east=4',
      'south=1.5&north=2&west=3&east=4',
      'south=18000&north=2&west=3&east=4',
      'south=1&north=2&west=36000&east=4',
      'south=5&north=2&west=3&east=4',
      'south=a&north=2&west=3&east=4',
    ]) {
      const response = await app.request(`/bids?${query}`);
      expect(response.status, query).toBe(400);
      expect((await response.json()).error).toBe('Invalid input');
    }
  });

  it('GET /bidder/:address returns the shapes, the history and the refund from the contract', async () => {
    const { app, apply, refunds } = await setup();
    await apply(5, [bid(0, 1n, ALICE, [sq(1, 1), sq(1, 2)], 1000n)]);
    await apply(6, [bid(0, 2n, BOB, [sq(1, 2)], 2000n)]);
    await apply(7, [{ logIndex: 0, eventName: 'AuctionPaused', args: {} }]);
    await apply(8, [{ logIndex: 0, eventName: 'AuctionCancelled', args: { by: BOB } }]);

    // Lower case is accepted; the answer has the checksum address.
    const response = await app.request(`/bidder/${ALICE.toLowerCase()}`);
    expect(response.status).toBe(200);
    const body: BidderView = await response.json();
    expect(body.bidder).toBe(ALICE);
    expect(body.refund).toBe('42');
    expect(refunds).toEqual([[ALICE, true]]);
    expect(body.shapes).toHaveLength(1);
    expect(body.shapes[0]).toMatchObject({ shapeId: 1, bidSquareIds: [sq(1, 1), sq(1, 2)], heldSquareIds: [sq(1, 1)] });
    expect(body.history.map((m) => (m.type === 'reorg' ? undefined : m.id.block))).toEqual([5, 6]);

    expect((await app.request('/bidder/0x123')).status).toBe(400);
    expect((await app.request('/nothing')).status).toBe(404);
  });

  it('GET /stream sends the stored messages after an event, then the live messages', async () => {
    const { app, apply } = await setup();
    await apply(5, [bid(0, 1n, ALICE, [sq(1, 1)], 1000n)]);
    await apply(6, [bid(3, 2n, BOB, [sq(1, 2)], 1000n)]);

    const stream = await open(app, '/stream?after=5:0');
    const first = await stream.next();
    expect(first.id).toBe('6:3');
    expect(first.event).toBe('shapeBid');
    expect(JSON.parse(first.data)).toMatchObject({ shapeId: 2, bidder: BOB });

    await apply(7, [bid(0, 3n, ALICE, [sq(1, 1)], 2000n), { logIndex: 1, eventName: 'AuctionExtended', args: { endTime: 1100n } }]);
    const live = await stream.json<StreamMessage>(2);
    expect(live.map((m) => [m.type, m.type === 'reorg' ? undefined : m.id])).toEqual([
      ['shapeBid', { block: 7, logIndex: 0 }],
      ['auctionStatus', { block: 7, logIndex: 1 }],
    ]);

    // With no message, the stream sends heartbeats.
    await expect(stream.next(200)).rejects.toThrow(/in time/);
    expect(stream.heartbeats).toBeGreaterThan(0);
  });

  it('GET /stream with no `after` sends all messages from the start', async () => {
    const { app, apply } = await setup();
    await apply(5, [bid(0, 1n, ALICE, [sq(1, 1)], 1000n)]);
    const stream = await open(app, '/stream');
    await apply(6, [bid(0, 2n, BOB, [sq(1, 1)], 2000n)]);
    expect((await stream.next()).id).toBe('5:0');
    expect((await stream.next()).id).toBe('6:0');
  });

  it('GET /stream resumes from Last-Event-ID before `after`', async () => {
    const { app, apply } = await setup();
    await apply(5, [bid(0, 1n, ALICE, [sq(1, 1)], 1000n)]);
    await apply(6, [bid(0, 2n, BOB, [sq(1, 1)], 2000n)]);
    await apply(7, [bid(0, 3n, ALICE, [sq(1, 1)], 3000n)]);
    // The browser reconnects with the URL of the first connection and the last id it got.
    const stream = await open(app, '/stream?after=4:0', { 'Last-Event-ID': '6:0' });
    expect((await stream.next()).id).toBe('7:0');

    expect((await app.request('/stream', { headers: { 'Last-Event-ID': 'x' } })).status).toBe(400);
    expect((await app.request('/stream?after=5')).status).toBe(400);
    expect((await app.request('/stream?bidder=0xabc')).status).toBe(400);
  });

  it('GET /stream with a bidder sends their messages and the status messages', async () => {
    const { app, apply } = await setup();
    const stream = await open(app, `/stream?bidder=${ALICE}`);
    await apply(5, [bid(0, 1n, BOB, [sq(1, 1)], 1000n)]); // not about Alice
    await apply(6, [bid(0, 2n, ALICE, [sq(1, 2)], 1000n)]);
    await apply(7, [bid(0, 3n, BOB, [sq(1, 2)], 2000n)]); // takes Alice's square
    await apply(8, [{ logIndex: 0, eventName: 'AuctionPaused', args: {} }]);
    const messages = await stream.json<StreamMessage>(3);
    expect(messages.map((m) => (m.type === 'reorg' ? undefined : m.id.block))).toEqual([6, 7, 8]);
  });

  it('GET /stream sends a reorg message, live and to a client that is ahead', async () => {
    const { app, apply, store, liveMessageBus } = await setup();
    await apply(5, [bid(0, 1n, ALICE, [sq(1, 1)], 1000n)]);
    await apply(6, [bid(0, 2n, BOB, [sq(1, 1)], 2000n)]);
    const stream = await open(app, '/stream?after=6:0');

    // The indexer undoes block 6 and publishes the reorg; then the new block 6 comes.
    await store.undoAfter(5);
    liveMessageBus.publish([{ type: 'reorg', lastEventId: await store.lastEventId() }]);
    await apply(6, [bid(0, 2n, ALICE, [sq(1, 2)], 1000n)]);
    const [reorg, replacement] = await stream.json<StreamMessage>(2);
    expect(reorg).toEqual({ type: 'reorg', lastEventId: { block: 5, logIndex: 0 } });
    expect(replacement).toMatchObject({ type: 'shapeBid', bidder: ALICE, id: { block: 6, logIndex: 0 } });

    // A client that resumes after an event that the store no longer has.
    const ahead = await open(app, '/stream?after=9:0');
    const resent = await ahead.next();
    expect(resent.id).toBe('6:0');
    expect(JSON.parse(resent.data)).toEqual({ type: 'reorg', lastEventId: { block: 6, logIndex: 0 } });
  });

  it('removes the listener when the client closes the stream', async () => {
    const { app, liveMessageBus, apply } = await setup();
    const stream = await open(app, '/stream');
    await apply(5, [bid(0, 1n, ALICE, [sq(1, 1)], 1000n)]);
    await stream.next();
    expect(liveMessageBus.size).toBe(1);
    await stream.close();
    readers.length = 0;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(liveMessageBus.size).toBe(0);
  });
});
