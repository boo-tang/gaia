// The bids that the map shows: viewport snapshots (`GET /bids`) and live stream messages
// (`GET /stream`) in one state.
//
// Each square keeps the ID of the event that its data comes from (`asOf`). Newer data replaces
// older data, so snapshots and stream messages can arrive in any order: a snapshot from before
// the stream position does not undo a live bid, and an old message does not undo a snapshot.
// During an auction a square never loses its bid (a higher bid replaces it), so a snapshot never
// removes a square. Only a reorg removes data.
//
// The bids map can hold many thousand squares. The reducer changes it in place and returns a new
// state object with a new `version`, so React and deck.gl see the change without a copy.
import {
  type Address,
  type AuctionStatus,
  type EventId,
  type StreamMessage,
  type Viewport,
  type ViewportSnapshot,
  isBefore,
} from '@gaia/core';

import { viewportContains, viewportHolds } from './areas';

/** The current highest bid on one square. */
export interface HeldBid {
  shapeId: number;
  bidder: Address;
  amount: bigint;
  /** The event that the data comes from. */
  asOf: EventId;
}

export interface BidsState {
  /** Key: the packed square ID. */
  bids: Map<number, HeldBid>;
  /** The areas of the snapshots. The stream keeps them current. */
  loaded: Viewport[];
  status?: AuctionStatus;
  statusAsOf?: EventId;
  /** The last event of the stream. */
  streamAfter?: EventId;
  /** Increments at each change of `bids`. */
  version: number;
  /** Increments at each reorg. A snapshot of an older generation has old data. */
  generation: number;
}

export type BidsAction =
  | { type: 'snapshot'; snapshot: ViewportSnapshot; generation: number }
  | { type: 'message'; message: StreamMessage }
  /** Removes the bids and the areas outside `keep`, to limit the memory. */
  | { type: 'evict'; keep: Viewport };

export const initialBidsState = (): BidsState => ({ bids: new Map(), loaded: [], version: 0, generation: 0 });

// True when data as of `next` replaces data as of `current`.
const isNewer = (next: EventId | undefined, current: EventId | undefined) =>
  next !== undefined && (current === undefined || isBefore(current, next));

const applySnapshot = (state: BidsState, snapshot: ViewportSnapshot): BidsState => {
  const asOf = snapshot.lastEventId;
  let changed = false;
  if (asOf !== undefined) {
    for (const bid of snapshot.bids) {
      const held = state.bids.get(bid.squareId);
      if (held === undefined || isBefore(held.asOf, asOf)) {
        state.bids.set(bid.squareId, { shapeId: bid.shapeId, bidder: bid.bidder, amount: BigInt(bid.amount), asOf });
        changed = true;
      }
    }
  }
  const loaded = state.loaded.some(area => viewportContains(area, snapshot.viewport))
    ? state.loaded
    : [...state.loaded.filter(area => !viewportContains(snapshot.viewport, area)), snapshot.viewport];
  const newStatus = isNewer(asOf, state.statusAsOf) || state.status === undefined;
  return {
    ...state,
    loaded,
    status: newStatus ? snapshot.status : state.status,
    statusAsOf: newStatus ? asOf : state.statusAsOf,
    version: changed ? state.version + 1 : state.version,
  };
};

const applyMessage = (state: BidsState, message: StreamMessage): BidsState => {
  if (message.type === 'reorg') {
    return {
      ...initialBidsState(),
      streamAfter: message.lastEventId,
      version: state.version + 1,
      generation: state.generation + 1,
    };
  }
  const streamAfter = isNewer(message.id, state.streamAfter) ? message.id : state.streamAfter;
  if (message.type === 'shapeBid') {
    let changed = false;
    message.squareIds.forEach((squareId, index) => {
      const held = state.bids.get(squareId);
      if (held === undefined || isBefore(held.asOf, message.id)) {
        const amount = BigInt(message.amounts[index]);
        state.bids.set(squareId, { shapeId: message.shapeId, bidder: message.bidder, amount, asOf: message.id });
        changed = true;
      }
    });
    return { ...state, streamAfter, version: changed ? state.version + 1 : state.version };
  }
  if (message.type === 'auctionStatus') {
    if (isNewer(message.id, state.statusAsOf)) {
      return { ...state, streamAfter, status: message.status, statusAsOf: message.id };
    }
    return { ...state, streamAfter };
  }
  // A settlement does not change the bids: the squares keep their winning bid.
  return { ...state, streamAfter };
};

const evict = (state: BidsState, keep: Viewport): BidsState => {
  let changed = false;
  for (const squareId of state.bids.keys()) {
    if (!viewportHolds(keep, squareId)) {
      state.bids.delete(squareId);
      changed = true;
    }
  }
  return {
    ...state,
    loaded: state.loaded.filter(area => viewportContains(keep, area)),
    version: changed ? state.version + 1 : state.version,
  };
};

export const reduceBids = (state: BidsState, action: BidsAction): BidsState => {
  if (action.type === 'snapshot') {
    if (action.generation !== state.generation) {
      return state;
    }
    return applySnapshot(state, action.snapshot);
  }
  if (action.type === 'message') {
    return applyMessage(state, action.message);
  }
  return evict(state, action.keep);
};
