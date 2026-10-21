// Types of the server API (apps/server), which the web app and the server share.
//
// JSON has no bigint: wei amounts, shape IDs and country IDs are decimal strings. A square ID is
// the packed value `(lat << 16) | lng` of the contracts (see grid.ts).
//
// Endpoints:
//   GET /auction                                   AuctionResponse
//   GET /bids?south=&north=&west=&east=            ViewportSnapshot (400 when it has too many bids)
//   GET /bidder/:address                           BidderView
//   GET /stream?after=<block>:<logIndex>&bidder=   SSE, one StreamMessage per event
//
// The stream: each SSE message has the event name `message.type`, the id
// `<block>:<logIndex>` of its position and the JSON of the message as data. A client gets a
// snapshot, then opens the stream with `after` = the position of the snapshot. When the
// connection breaks, the browser reconnects and sends `Last-Event-ID`, so it misses nothing.

import type { Address } from './deployment';

/**
 * A place in the chain history. The server applies events in this order. `logIndex` -1 means
 * "before the first log of `block`": a server that has applied a block with no auction event is
 * at `{ block, logIndex: -1 }`.
 */
export interface Position {
  block: number;
  logIndex: number;
}

/** True when `a` comes before `b`. */
export const isBefore = (a: Position, b: Position) =>
  a.block < b.block || (a.block === b.block && a.logIndex < b.logIndex);

/** The SSE id of a position: `<block>:<logIndex>`. */
export const formatPosition = (p: Position) => `${p.block}:${p.logIndex}`;

/** Reads an SSE id. Returns undefined when the text is not `<block>:<logIndex>`. */
export const parsePosition = (text: string): Position | undefined => {
  const match = /^(\d{1,15}):(-1|\d{1,9})$/.exec(text);
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
  position: Position;
  rules: AuctionRules;
  status: AuctionStatus;
}

/** The current highest bid on one square. */
export interface SquareBid {
  squareId: number;
  shapeId: string;
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

/** GET /bids: all bids in a viewport at `position`. The stream continues after `position`. */
export interface ViewportSnapshot {
  position: Position;
  viewport: Viewport;
  status: AuctionStatus;
  bids: SquareBid[];
}

/** One shape (one bid) and what is left of it. */
export interface Shape {
  shapeId: string;
  bidder: Address;
  block: number;
  /** Unix seconds, from the block. */
  timestamp: number;
  /** The squares of the bid, in bid order. */
  squareIds: number[];
  /** The squares that the shape still holds. The others went to later shapes. */
  liveSquareIds: number[];
  /** The number of squares that settlement gave to the country of the shape. */
  settledSquares: number;
  /** The country of the shape, after the first settlement chunk. */
  countryId?: string;
  /** True when the winner has the country (`ShapeSettled`). */
  settled: boolean;
}

/** GET /bidder/:address. */
export interface BidderView {
  position: Position;
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
  shapeId: string;
  /** The bidder of the older shape. The same as the new bidder for a re-bid on own squares. */
  bidder: Address;
  squareIds: number[];
}

/** One `ShapeBid` event: the new shape and the amounts of all its squares after the bid. */
export interface ShapeBidMessage {
  type: 'shapeBid';
  position: Position;
  timestamp: number;
  shapeId: string;
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
  position: Position;
  timestamp: number;
  status: AuctionStatus;
}

/** One settlement event: `ShapeSquaresSettled` (a chunk) or `ShapeSettled` (the last step). */
export interface SettlementMessage {
  type: 'settlement';
  position: Position;
  timestamp: number;
  shapeId: string;
  bidder: Address;
  countryId: string;
  /** All squares settled so far for this shape. */
  settledSquares: number;
  /** True for `ShapeSettled`: the winner has the country. */
  settled: boolean;
}

/**
 * The chain dropped blocks. The server is now at `position`. The client discards its data and
 * gets a new snapshot. Only the live stream sends it; it is not part of the history.
 */
export interface ReorgMessage {
  type: 'reorg';
  position: Position;
}

/** A message of the live stream. A client resumes the stream from the last `position`. */
export type StreamMessage = ShapeBidMessage | AuctionStatusMessage | SettlementMessage | ReorgMessage;
