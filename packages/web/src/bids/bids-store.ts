// The owner of the map data: it loads viewport snapshots, keeps one live stream open and gives
// the state to React (`useSyncExternalStore`, see useBids.ts). The data rules are in
// bids-reducer.ts.
import type { EventId, StreamMessage, Viewport } from '@gaia/core';

import { type ApiClient, ApiError } from '../api/api-client';
import { viewportContains } from './areas';
import { type BidsAction, type BidsState, initialBidsState, reduceBids } from './bids-reducer';

/**
 * The live stream: `idle` before the first snapshot, `connecting` while the browser connects,
 * `open`, and `down` after it was not open for `downAfterMs`.
 */
export type StreamState = 'idle' | 'connecting' | 'open' | 'down';

export interface BidsView {
  data: BidsState;
  /** The last viewport had more bids than the server sends ("zoom in"). */
  tooMany: boolean;
  /** A snapshot request is in progress. */
  loading: boolean;
  /** The last snapshot request failed after its retries (network or server error). */
  serverError: boolean;
  stream: StreamState;
}

/** The part of `EventSource` that the store uses (tests use a fake). */
export interface EventSourceLike {
  readonly readyState: number;
  onopen: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  addEventListener: (type: string, listener: (event: MessageEvent<string>) => void) => void;
  close: () => void;
}

export interface BidsStoreOptions {
  client: Pick<ApiClient, 'getAuction' | 'getBids' | 'streamUrl'>;
  openEventSource: (url: string) => EventSourceLike;
  /** Above this number of squares, the store removes the bids outside the current viewport. */
  maxBids?: number;
  /** The stream is `down` when it is not open for this time after an error. */
  downAfterMs?: number;
}

export interface BidsStore {
  getView: () => BidsView;
  subscribe: (listener: () => void) => () => void;
  /** Makes sure that the bids of `viewport` are loaded. Call it after each map move. */
  requestArea: (viewport: Viewport) => void;
  /** Each stream message, after the store applied it. */
  onMessage: (listener: (message: StreamMessage) => void) => () => void;
  /** Closes the stream and stops all timers. */
  close: () => void;
}

const EVENTSOURCE_CLOSED = 2;
const MESSAGE_TYPES: StreamMessage['type'][] = ['shapeBid', 'auctionStatus', 'settlement', 'reorg'];
const SNAPSHOT_RETRIES = 3;
const STREAM_RETRY_MIN_MS = 2_000;
const STREAM_RETRY_MAX_MS = 60_000;

export const createBidsStore = ({
  client,
  openEventSource,
  maxBids = 200_000,
  downAfterMs = 5_000,
}: BidsStoreOptions): BidsStore => {
  let view: BidsView = { data: initialBidsState(), tooMany: false, loading: false, serverError: false, stream: 'idle' };
  const listeners = new Set<() => void>();
  const messageListeners = new Set<(message: StreamMessage) => void>();

  // The viewport of the last `requestArea` call, and a request that waits for the current one.
  let wanted: Viewport | undefined;
  let queued: Viewport | undefined;
  let inFlight = false;
  // The last viewport with too many bids. The same viewport gets the same answer.
  let tooManyArea: Viewport | undefined;

  let source: EventSourceLike | undefined;
  // The stream continues after this event: the first snapshot, then the last message.
  let streamFrom: EventId | undefined;
  let streamRetryMs = STREAM_RETRY_MIN_MS;
  let downTimer: ReturnType<typeof setTimeout> | undefined;
  let reopenTimer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const setView = (change: Partial<BidsView>) => {
    view = { ...view, ...change };
    for (const listener of listeners) {
      listener();
    }
  };

  const dispatch = (action: BidsAction) => {
    const data = reduceBids(view.data, action);
    if (data !== view.data) {
      setView({ data });
    }
  };

  const sameArea = (a: Viewport, b: Viewport) =>
    a.south === b.south && a.north === b.north && a.west === b.west && a.east === b.east;

  const isLoaded = (viewport: Viewport) => view.data.snapshotAreas.some(area => viewportContains(area, viewport));

  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  let auctionRequest = false;
  const streamStarted = () => source !== undefined || reopenTimer !== undefined || auctionRequest;

  // Without a snapshot (the first viewport has too many bids), the stream starts after the last
  // event of `GET /auction`. A later snapshot merges with it by event ID.
  const startStreamFromAuction = async () => {
    if (streamStarted()) {
      return;
    }
    auctionRequest = true;
    try {
      const auction = await client.getAuction();
      auctionRequest = false;
      if (!closed && !streamStarted()) {
        openStream(auction.lastEventId);
      }
    } catch {
      // The next snapshot opens the stream.
      auctionRequest = false;
    }
  };

  const load = async (viewport: Viewport) => {
    inFlight = true;
    setView({ loading: true });
    // After a reorg during this request, the reducer ignores the answer (`BidsState.reorgCount`).
    const reorgCount = view.data.reorgCount;
    for (let attempt = 0; ; attempt++) {
      try {
        const snapshot = await client.getBids(viewport);
        if (closed) {
          return;
        }
        dispatch({ type: 'snapshot', snapshot, reorgCount });
        if (view.data.bids.size > maxBids) {
          dispatch({ type: 'evict', keep: viewport });
        }
        tooManyArea = undefined;
        setView({ tooMany: false, serverError: false });
        if (!streamStarted()) {
          openStream(snapshot.lastEventId);
        }
        break;
      } catch (error) {
        if (closed) {
          return;
        }
        if (error instanceof ApiError && error.status === 400) {
          // Too many bids: keep the bids that the map has.
          tooManyArea = viewport;
          setView({ tooMany: true });
          void startStreamFromAuction();
          break;
        }
        const retryable = !(error instanceof ApiError && error.status < 500);
        if (!retryable || attempt >= SNAPSHOT_RETRIES - 1) {
          setView({ serverError: true });
          break;
        }
        await wait(1000 * 2 ** attempt);
      }
    }
    inFlight = false;
    setView({ loading: false });
    const next = queued;
    queued = undefined;
    if (next !== undefined && !isLoaded(next)) {
      void load(next);
    }
  };

  const request = (viewport: Viewport) => {
    if (inFlight) {
      queued = viewport;
    } else {
      void load(viewport);
    }
  };

  const requestArea = (viewport: Viewport) => {
    wanted = viewport;
    if (isLoaded(viewport)) {
      queued = undefined;
      if (view.tooMany) {
        setView({ tooMany: false });
      }
      return;
    }
    if (tooManyArea !== undefined && sameArea(tooManyArea, viewport)) {
      return;
    }
    request(viewport);
  };

  const startDownTimer = () => {
    if (downTimer === undefined) {
      downTimer = setTimeout(() => {
        downTimer = undefined;
        if (view.stream !== 'open') {
          setView({ stream: 'down' });
        }
      }, downAfterMs);
    }
  };

  const onStreamMessage = (event: MessageEvent<string>) => {
    let message: StreamMessage;
    try {
      message = JSON.parse(event.data) as StreamMessage;
    } catch {
      return;
    }
    dispatch({ type: 'message', message });
    streamFrom = view.data.lastStreamEventId ?? streamFrom;
    if (message.type === 'reorg') {
      // The data is gone: load the current viewport again.
      streamFrom = message.lastEventId;
      tooManyArea = undefined;
      if (wanted !== undefined) {
        request(wanted);
      }
    }
    for (const listener of messageListeners) {
      listener(message);
    }
  };

  function openStream(after: EventId | undefined) {
    streamFrom = after;
    const next = openEventSource(client.streamUrl(after));
    source = next;
    if (view.stream !== 'down') {
      setView({ stream: 'connecting' });
    }
    next.onopen = () => {
      streamRetryMs = STREAM_RETRY_MIN_MS;
      clearTimeout(downTimer);
      downTimer = undefined;
      setView({ stream: 'open' });
    };
    next.onerror = () => {
      if (source !== next) {
        return;
      }
      if (view.stream === 'open') {
        setView({ stream: 'connecting' });
      }
      startDownTimer();
      if (next.readyState === EVENTSOURCE_CLOSED) {
        // The browser does not try again (an HTTP error or a wrong answer): open a new stream.
        next.close();
        source = undefined;
        reopenTimer = setTimeout(() => {
          reopenTimer = undefined;
          openStream(streamFrom);
        }, streamRetryMs);
        streamRetryMs = Math.min(streamRetryMs * 2, STREAM_RETRY_MAX_MS);
      }
    };
    for (const type of MESSAGE_TYPES) {
      next.addEventListener(type, onStreamMessage);
    }
  }

  return {
    getView: () => view,
    subscribe: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    requestArea,
    onMessage: listener => {
      messageListeners.add(listener);
      return () => messageListeners.delete(listener);
    },
    close: () => {
      closed = true;
      source?.close();
      source = undefined;
      clearTimeout(downTimer);
      clearTimeout(reopenTimer);
    },
  };
};
