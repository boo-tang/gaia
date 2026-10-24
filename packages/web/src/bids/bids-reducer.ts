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
// state object with a new `bidsVersion`, so React and deck.gl see the change without a copy.
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
  /**
   * The areas that a snapshot loaded. `bids` holds all bids in these areas (the stream keeps them
   * current), so the store asks for no snapshot inside them.
   */
  snapshotAreas: Viewport[];
  status?: AuctionStatus;
  /** The event that `status` comes from. An older status does not replace it. */
  statusEventId?: EventId;
  /** The last event that came from the stream. A new stream continues after it. */
  lastStreamEventId?: EventId;
  /**
   * Increments at each change of `bids`. The map is changed in place, so this number is how
   * React and deck.gl see a change (`updateTriggers`).
   */
  bidsVersion: number;
  /**
   * Increments at each reorg. A snapshot request keeps the count from when it started. If a
   * reorg comes before its answer, the answer can hold bids of dropped blocks, and the event-ID
   * rule cannot find them (the reorg emptied `bids`), so the reducer ignores that answer.
   */
  reorgCount: number;
}

export type BidsAction =
  /** `reorgCount`: the value of `BidsState.reorgCount` when the request started. */
  | { type: 'snapshot'; snapshot: ViewportSnapshot; reorgCount: number }
  | { type: 'message'; message: StreamMessage }
  /** Removes the bids and the areas outside `keep`, to limit the memory. */
  | { type: 'evict'; keep: Viewport };

export const initialBidsState = (): BidsState => ({
  bids: new Map(),
  snapshotAreas: [],
  bidsVersion: 0,
  reorgCount: 0,
});

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
  const snapshotAreas = state.snapshotAreas.some(area => viewportContains(area, snapshot.viewport))
    ? state.snapshotAreas
    : [...state.snapshotAreas.filter(area => !viewportContains(snapshot.viewport, area)), snapshot.viewport];
  const newStatus = isNewer(asOf, state.statusEventId) || state.status === undefined;
  return {
    ...state,
    snapshotAreas,
    status: newStatus ? snapshot.status : state.status,
    statusEventId: newStatus ? asOf : state.statusEventId,
    bidsVersion: changed ? state.bidsVersion + 1 : state.bidsVersion,
  };
};

const applyMessage = (state: BidsState, message: StreamMessage): BidsState => {
  if (message.type === 'reorg') {
    return {
      ...initialBidsState(),
      lastStreamEventId: message.lastEventId,
      bidsVersion: state.bidsVersion + 1,
      reorgCount: state.reorgCount + 1,
    };
  }
  const lastStreamEventId = isNewer(message.id, state.lastStreamEventId) ? message.id : state.lastStreamEventId;
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
    return { ...state, lastStreamEventId, bidsVersion: changed ? state.bidsVersion + 1 : state.bidsVersion };
  }
  if (message.type === 'auctionStatus') {
    if (isNewer(message.id, state.statusEventId)) {
      return { ...state, lastStreamEventId, status: message.status, statusEventId: message.id };
    }
    return { ...state, lastStreamEventId };
  }
  // A settlement does not change the bids: the squares keep their winning bid.
  return { ...state, lastStreamEventId };
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
    snapshotAreas: state.snapshotAreas.filter(area => viewportContains(keep, area)),
    bidsVersion: changed ? state.bidsVersion + 1 : state.bidsVersion,
  };
};

export const reduceBids = (state: BidsState, action: BidsAction): BidsState => {
  if (action.type === 'snapshot') {
    if (action.reorgCount !== state.reorgCount) {
      return state;
    }
    return applySnapshot(state, action.snapshot);
  }
  if (action.type === 'message') {
    return applyMessage(state, action.message);
  }
  return evict(state, action.keep);
};
