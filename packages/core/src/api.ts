// Types of the server API (packages/server), which the web app and the server share.
//
// Wei amounts are decimal strings (JSON has no bigint, and an amount can be above 2^53). Shape
// and country IDs are numbers: the contracts count them up from 1. A square ID is the packed
// value `(lat << 16) | lng` of the contracts (see grid.ts).
//
// Endpoints:
//   GET /auction                                   AuctionResponse
//   GET /bids?south=&north=&west=&east=            ViewportSnapshot (400 when it has too many bids)
//   GET /bidder/:address                           BidderView
//   GET /stream?after=<block>:<logIndex>&bidder=   SSE, one StreamMessage per event
//
// The stream: each SSE message has the event name `message.type`, the event ID as its SSE id and
// the JSON of the message as data. A client gets a snapshot, then opens the stream with
// `after` = `lastEventId` of the snapshot (no `after`: all messages from the start). When the
// connection breaks, the browser reconnects and sends `Last-Event-ID`, so it misses nothing.

import type { Address } from './deployment';

/**
 * The ID of one contract event: its block and its log index in that block. The server applies
 * events in this order. As text (the SSE id): `<block>:<logIndex>`.
 */
export interface EventId {
  block: number;
  logIndex: number;
}

/** True when event `a` comes before event `b`. */
export const isBefore = (a: EventId, b: EventId) =>
  a.block < b.block || (a.block === b.block && a.logIndex < b.logIndex);

/** The SSE id of an event: `<block>:<logIndex>`. */
export const formatEventId = (id: EventId) => `${id.block}:${id.logIndex}`;

/** Reads an SSE id. Returns undefined when the text is not `<block>:<logIndex>`. */
export const parseEventId = (text: string): EventId | undefined => {
  const match = /^(\d{1,15}):(\d{1,9})$/.exec(text);
  if (match === null) return undefined;
  return { block: Number(match[1]), logIndex: Number(match[2]) };
};

/** The auction values that never change after the deployment (constructor values). */
export interface AuctionRules {
  chainId: number;
  auction: Address;
  /** Unix seconds. */
  startTime: number;
  /** Unix seconds. The soft close never moves `endTime` past this value. */
  maxEndTime: number;
  /** Seconds. */
  extensionWindow: number;
  /** Wei, as a decimal string. */
  minBidPerSquareWei: string;
  minBidIncrementBps: number;
  minShapeSquares: number;
  maxShapeSquares: number;
  maxShapeAspectRatio: number;
}

/** The auction values that events change. */
export interface AuctionStatus {
  /** Unix seconds. The current end: a late bid moves it, up to `maxEndTime`. */
  endTime: number;
  paused: boolean;
  cancelled: boolean;
}

/** GET /auction. */
export interface AuctionResponse {
  /** The last event in the data. Not there before the first auction event. */
  lastEventId?: EventId;
  rules: AuctionRules;
  status: AuctionStatus;
}

/** The current highest bid on one square. */
export interface SquareBid {
  squareId: number;
  shapeId: number;
  bidder: Address;
  /** Wei, as a decimal string. */
  amount: string;
}

/**
 * A rectangle of squares, in contract values: rows `south` to `north` and columns `west` to
 * `east`, all included. `west` can be larger than `east`: then the rectangle crosses the
 * antimeridian.
 */
export interface Viewport {
  south: number;
  north: number;
  west: number;
  east: number;
}

/** GET /bids: all bids in a viewport. The stream continues after `lastEventId`. */
export interface ViewportSnapshot {
  /** The last event in the data. Not there before the first auction event. */
  lastEventId?: EventId;
  viewport: Viewport;
  status: AuctionStatus;
  bids: SquareBid[];
}

/**
 * The settlement of a shape after the auction. `settleShape` moves the squares into a new
 * country in chunks of rows, so it can take more than one transaction.
 */
export interface Settlement {
  countryId: number;
  /** The squares that are in the country now. */
  settledSquareCount: number;
  /** True after the last chunk: the winner has the country (`ShapeSettled`). */
  done: boolean;
}

/** One shape (one bid) and what is left of it. */
export interface Shape {
  shapeId: number;
  bidder: Address;
  block: number;
  /** Unix seconds, from the block. */
  timestamp: number;
  /** The squares of the bid, in bid order. */
  bidSquareIds: number[];
  /**
   * The squares of the bid that the shape still holds. Later bids took the others. The count is
   * the contract view `shapeLiveSquares`.
   */
  heldSquareIds: number[];
  /** Not there until the first settlement chunk. */
  settlement?: Settlement;
}

/** GET /bidder/:address. */
export interface BidderView {
  /** The last event in the data. Not there before the first auction event. */
  lastEventId?: EventId;
  bidder: Address;
  /** All shapes of the bidder, also the shapes that lost all their squares. Oldest first. */
  shapes: Shape[];
  /**
   * Wei, as a decimal string: what `withdraw` sends now. The server reads it from the contract
   * at each request (`pendingReturns`, plus `activeBids` after a cancel).
   */
  refund: string;
  /** The messages about this bidder: their bids, their lost squares, their settlements. */
  history: StreamMessage[];
}

/** Squares that a bid took from an older shape. */
export interface TakenSquares {
  shapeId: number;
  /** The bidder of the older shape. The same as the new bidder for a re-bid on own squares. */
  bidder: Address;
  squareIds: number[];
}

/** One `ShapeBid` event: the new shape and the amounts of all its squares after the bid. */
export interface ShapeBidMessage {
  type: 'shapeBid';
  id: EventId;
  timestamp: number;
  shapeId: number;
  bidder: Address;
  squareIds: number[];
  /** Wei, as decimal strings, in the order of `squareIds`. */
  amounts: string[];
  /** Wei, as a decimal string: the ETH that the bid spent, without the excess. */
  paid: string;
  /** The squares that the bid took from older shapes, for each older shape. */
  taken: TakenSquares[];
}

/** A change of the auction status: soft close, pause, unpause or cancel. */
export interface AuctionStatusMessage {
  type: 'auctionStatus';
  id: EventId;
  timestamp: number;
  status: AuctionStatus;
}

/** One settlement event: `ShapeSquaresSettled` (a chunk) or `ShapeSettled` (the last step). */
export interface SettlementMessage {
  type: 'settlement';
  id: EventId;
  timestamp: number;
  shapeId: number;
  bidder: Address;
  settlement: Settlement;
}

/**
 * The chain dropped blocks, and the server removed their events. The client discards its data
 * and gets a new snapshot. Only the live stream sends it; it is not part of the history.
 */
export interface ReorgMessage {
  type: 'reorg';
  /** The last event that the server still has. */
  lastEventId?: EventId;
}

/** A message of the live stream. */
export type StreamMessage = ShapeBidMessage | AuctionStatusMessage | SettlementMessage | ReorgMessage;
