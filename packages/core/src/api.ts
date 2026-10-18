// Types of the server API, which the web app and the server share.
//
// FIRST DRAFT. The server work (indexer, viewport API and live stream) sets the final types.
// Keep this file small until then.
//
// JSON has no bigint: wei amounts and shape IDs are decimal strings. A square is the packed
// value `(lat << 16) | lng` (see grid.ts).

import type { Address } from './deployment';

/** A place in the chain history. The server applies events in this order. */
export interface Position {
  block: number;
  logIndex: number;
}

/** The state of the auction at `position`. */
export interface AuctionState {
  position: Position;
  /** Unix seconds. The current end: a late bid moves it, up to `maxEndTime`. */
  endTime: number;
  maxEndTime: number;
  paused: boolean;
  cancelled: boolean;
}

/** The current highest bid on one square. */
export interface SquareBid {
  square: number;
  shapeId: string;
  bidder: Address;
  /** Wei, as a decimal string. */
  amount: string;
}

/**
 * A rectangle of squares, in contract values. `west` can be larger than `east`: then the
 * rectangle crosses the antimeridian.
 */
export interface Viewport {
  south: number;
  north: number;
  west: number;
  east: number;
}

/** All bids in a viewport at `position`. The stream continues after `position`. */
export interface ViewportSnapshot {
  position: Position;
  viewport: Viewport;
  auction: AuctionState;
  bids: SquareBid[];
}

/** One `ShapeBid` event: the new shape and the amounts of all its squares after the bid. */
export interface ShapeBidMessage {
  type: 'shapeBid';
  position: Position;
  shapeId: string;
  bidder: Address;
  squares: number[];
  /** Wei, as decimal strings, in the order of `squares`. */
  amounts: string[];
}

/** A change of the auction state (soft close, pause, unpause or cancel). */
export interface AuctionStateMessage {
  type: 'auctionState';
  position: Position;
  auction: AuctionState;
}

/**
 * The chain dropped blocks after `position`. The client discards its data after `position` and
 * asks for a new snapshot.
 */
export interface ReorgMessage {
  type: 'reorg';
  position: Position;
}

/** A message of the live stream. A client resumes the stream from the last `position`. */
export type StreamMessage = ShapeBidMessage | AuctionStateMessage | ReorgMessage;
