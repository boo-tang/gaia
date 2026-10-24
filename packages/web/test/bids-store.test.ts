import type { Address, StreamMessage, Viewport, ViewportSnapshot } from '@gaia/core';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../src/api/api-client';
import { type BidsStore, type EventSourceLike, createBidsStore } from '../src/bids/bids-store';

const ALICE: Address = '0x00000000000000000000000000000000000000a1';
const AREA: Viewport = { south: 90, north: 110, west: 190, east: 210 };
const INSIDE: Viewport = { south: 95, north: 105, west: 195, east: 205 };
const OTHER: Viewport = { south: 5000, north: 5010, west: 0, east: 10 };

const snapshot = (block: number, viewport: Viewport, squareId = 100 * 65536 + 200): ViewportSnapshot => ({
  lastEventId: { block, logIndex: 0 },
  viewport,
  status: { endTime: 5000, paused: false, cancelled: false },
  bids: [{ squareId, shapeId: 1, bidder: ALICE, amount: '100' }],
});

class FakeEventSource implements EventSourceLike {
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;
  private readonly listeners = new Map<string, ((event: MessageEvent<string>) => void)[]>();

  constructor(readonly url: string) {}

  addEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close() {
    this.closed = true;
    this.readyState = 2;
  }

  open() {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }

  fail(readyState: 0 | 2) {
    this.readyState = readyState;
    this.onerror?.(new Event('error'));
  }

  send(message: StreamMessage) {
    for (const listener of this.listeners.get(message.type) ?? []) {
      listener(new MessageEvent(message.type, { data: JSON.stringify(message) }));
    }
  }
}

// Lets the awaited promises of the store run.
const settle = () => vi.advanceTimersByTimeAsync(0);

describe('createBidsStore', () => {
  let getBids: ReturnType<typeof vi.fn<(viewport: Viewport) => Promise<ViewportSnapshot>>>;
  let sources: FakeEventSource[];
  let store: BidsStore;

  beforeEach(() => {
    vi.useFakeTimers();
    getBids = vi.fn<(viewport: Viewport) => Promise<ViewportSnapshot>>();
    sources = [];
    store = createBidsStore({
      client: {
        getBids,
        streamUrl: after => `/api/stream${after ? `?after=${after.block}:${after.logIndex}` : ''}`,
      },
      openEventSource: url => {
        const source = new FakeEventSource(url);
        sources.push(source);
        return source;
      },
    });
  });

  afterEach(() => {
    store.close();
    vi.useRealTimers();
  });

  it('loads a snapshot, then opens the stream after its last event', async () => {
    getBids.mockResolvedValueOnce(snapshot(10, AREA));
    store.requestArea(AREA);
    expect(store.getView().loading).toBe(true);
    await settle();
    expect(store.getView().data.bids.size).toBe(1);
    expect(store.getView().loading).toBe(false);
    expect(sources.map(s => s.url)).toEqual(['/api/stream?after=10:0']);
    expect(store.getView().stream).toBe('connecting');
    sources[0].open();
    expect(store.getView().stream).toBe('open');
  });

  it('does not load an area inside a loaded area, and opens one stream only', async () => {
    getBids.mockResolvedValueOnce(snapshot(10, AREA)).mockResolvedValueOnce(snapshot(12, OTHER, 5000 * 65536 + 5));
    store.requestArea(AREA);
    await settle();
    store.requestArea(INSIDE);
    store.requestArea(OTHER);
    await settle();
    expect(getBids.mock.calls.map(([viewport]) => viewport)).toEqual([AREA, OTHER]);
    expect(store.getView().data.bids.size).toBe(2);
    expect(sources).toHaveLength(1);
  });

  it('loads only the newest of the areas asked during a request', async () => {
    getBids.mockResolvedValue(snapshot(10, AREA));
    store.requestArea(AREA);
    store.requestArea({ ...OTHER, north: 5001 });
    store.requestArea(OTHER);
    await settle();
    expect(getBids.mock.calls.map(([viewport]) => viewport)).toEqual([AREA, OTHER]);
  });

  it('keeps the bids on HTTP 400 and does not ask for the same area again', async () => {
    getBids.mockResolvedValueOnce(snapshot(10, AREA)).mockRejectedValueOnce(new ApiError('/bids', 400, {}));
    store.requestArea(AREA);
    await settle();
    store.requestArea(OTHER);
    await settle();
    expect(store.getView().tooMany).toBe(true);
    expect(store.getView().data.bids.size).toBe(1);
    store.requestArea(OTHER);
    await settle();
    expect(getBids).toHaveBeenCalledTimes(2);
    store.requestArea(INSIDE);
    expect(store.getView().tooMany).toBe(false);
  });

  it('tries again after a server error, then reports it', async () => {
    getBids.mockRejectedValue(new ApiError('/bids', 503, ''));
    store.requestArea(AREA);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(getBids).toHaveBeenCalledTimes(3);
    expect(store.getView().serverError).toBe(true);
    expect(sources).toHaveLength(0);
  });

  it('applies stream messages and gives them to the listeners', async () => {
    getBids.mockResolvedValueOnce(snapshot(10, AREA));
    const received: StreamMessage[] = [];
    store.onMessage(message => received.push(message));
    store.requestArea(AREA);
    await settle();
    const message: StreamMessage = {
      type: 'shapeBid',
      id: { block: 11, logIndex: 0 },
      timestamp: 1,
      shapeId: 2,
      bidder: ALICE,
      squareIds: [7],
      amounts: ['5'],
      paid: '5',
      taken: [],
    };
    sources[0].send(message);
    expect(store.getView().data.bids.get(7)?.amount).toBe(5n);
    expect(received).toEqual([message]);
  });

  it('loads the viewport again after a reorg and ignores the old answer', async () => {
    let answerOld: (snapshot: ViewportSnapshot) => void = () => {};
    getBids
      .mockResolvedValueOnce(snapshot(10, AREA))
      .mockReturnValueOnce(new Promise(resolve => (answerOld = resolve)))
      .mockResolvedValueOnce(snapshot(9, OTHER, 5000 * 65536 + 6));
    store.requestArea(AREA);
    await settle();
    store.requestArea(OTHER);
    sources[0].send({ type: 'reorg', lastEventId: { block: 9, logIndex: 0 } });
    expect(store.getView().data.bids.size).toBe(0);
    answerOld(snapshot(10, OTHER, 5000 * 65536 + 5));
    await settle();
    expect([...store.getView().data.bids.keys()]).toEqual([5000 * 65536 + 6]);
    expect(sources).toHaveLength(1);
  });

  it('is down after 5 s without a connection and opens a new stream after the last event', async () => {
    getBids.mockResolvedValueOnce(snapshot(10, AREA));
    store.requestArea(AREA);
    await settle();
    sources[0].open();
    sources[0].send({
      type: 'auctionStatus',
      id: { block: 12, logIndex: 1 },
      timestamp: 1,
      status: { endTime: 6000, paused: false, cancelled: false },
    });
    sources[0].fail(0);
    expect(store.getView().stream).toBe('connecting');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(store.getView().stream).toBe('down');

    sources[0].fail(2);
    expect(sources[0].closed).toBe(true);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(sources[1].url).toBe('/api/stream?after=12:1');
    expect(store.getView().stream).toBe('down');
    sources[1].fail(2);
    await vi.advanceTimersByTimeAsync(3_999);
    expect(sources).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    sources[2].open();
    expect(store.getView().stream).toBe('open');
  });

  it('is not down after a short break', async () => {
    getBids.mockResolvedValueOnce(snapshot(10, AREA));
    store.requestArea(AREA);
    await settle();
    sources[0].open();
    sources[0].fail(0);
    await vi.advanceTimersByTimeAsync(1_000);
    sources[0].open();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(store.getView().stream).toBe('open');
  });
});
