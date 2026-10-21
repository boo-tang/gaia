// The store interface. The indexer, the API and the stream use only this interface, so another
// implementation (for example a database) can replace the in-memory store with no other change.
//
// The store does not know the auction rules. The event reducer (indexer/reducer.ts) reads the
// current state with `squares` and `shapes`, and gives the new values of one block to
// `applyBlock`. The store saves them.
//
// A store has a start position and a start status (from the deployment file). `reset` goes back
// to them.

import type {
  Address,
  AuctionStatus,
  BidderView,
  Position,
  SquareBid,
  StreamMessage,
  Viewport,
} from '@gaia/core';
import type { Hex } from 'viem';

/** A block that the store has applied. */
export interface BlockRef {
  number: number;
  hash: Hex;
}

/** The current bid of one square. The bidder is the bidder of the shape. */
export interface StoredSquare {
  squareId: number;
  shapeId: bigint;
  amount: bigint;
}

/** One shape, as the reducer reads and writes it. */
export interface StoredShape {
  shapeId: bigint;
  bidder: Address;
  block: number;
  timestamp: number;
  /** The squares of the bid, in bid order. */
  squareIds: number[];
  /** The number of squares that the shape still holds. */
  liveSquares: number;
  settledSquares: number;
  /** 0n until the first settlement chunk. */
  countryId: bigint;
  settled: boolean;
}

/** All changes of one block. The store applies them in one step. */
export interface BlockChanges {
  block: BlockRef;
  /** The store position after this block. */
  position: Position;
  /** The new value of each square that changed. */
  squares: StoredSquare[];
  /** The new value of each shape that is new or changed. */
  shapes: StoredShape[];
  /** The new status, if it changed. */
  status: AuctionStatus | undefined;
  /** One message for each event of the block, in log order. No reorg messages. */
  messages: StreamMessage[];
}

/** A filter for stream messages. */
export interface MessageFilter {
  /**
   * Only the messages about this bidder (their bids, the squares they lost, their settlements),
   * and all auction status messages.
   */
  bidder?: Address;
}

/** The bidder view without the refund (the API reads the refund from the contract). */
export type StoredBidderView = Omit<BidderView, 'refund'>;

export interface Store {
  // --- Indexer ---

  /** The position after the last applied event (or the start position). */
  position(): Promise<Position>;
  /** The last applied block, or undefined when the store has no block. */
  cursor(): Promise<BlockRef | undefined>;
  /**
   * The applied blocks that `undoAfter` can still undo, newest first. The indexer compares
   * their hashes with the chain to find where a reorg starts.
   */
  recentBlocks(): Promise<BlockRef[]>;
  /** Applies the changes, the messages and the new cursor of one block, in one step. */
  applyBlock(changes: BlockChanges): Promise<void>;
  /**
   * Undoes all blocks after block `block` (reorg). Throws `UndoTooDeepError` when a block to
   * undo is older than the undo window; the store is then unchanged.
   */
  undoAfter(block: number): Promise<void>;
  /** Removes all data. The store goes back to its start position and status. */
  reset(): Promise<void>;

  // --- Reducer ---

  /** The current bids of these squares. A square with no bid is not in the result. */
  squares(squareIds: readonly number[]): Promise<StoredSquare[]>;
  /** These shapes. An unknown shape is not in the result. */
  shapes(shapeIds: readonly bigint[]): Promise<StoredShape[]>;
  status(): Promise<AuctionStatus>;

  // --- API ---

  /**
   * The bids in a viewport, with the position of the data. Returns at most `limit` bids; when
   * the viewport has more, `complete` is false.
   */
  bidsInViewport(
    viewport: Viewport,
    limit: number,
  ): Promise<{ position: Position; bids: SquareBid[]; complete: boolean }>;
  /** The shapes and the history of a bidder. */
  bidder(address: Address): Promise<StoredBidderView>;
  /** The stored messages after `after`, in order. */
  messagesAfter(after: Position, filter?: MessageFilter): Promise<StreamMessage[]>;
}

export class UndoTooDeepError extends Error {
  constructor(block: number) {
    super(`Cannot undo the blocks after ${block}: they are older than the undo window.`);
    this.name = 'UndoTooDeepError';
  }
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** True when `message` passes `filter`. Each store and the live stream use this rule. */
export const messageMatches = (message: StreamMessage, filter: MessageFilter = {}): boolean => {
  const { bidder } = filter;
  if (bidder === undefined) return true;
  if (message.type === 'shapeBid') {
    return same(message.bidder, bidder) || message.taken.some((t) => same(t.bidder, bidder));
  } else if (message.type === 'settlement') {
    return same(message.bidder, bidder);
  }
  // Auction status and reorg messages are for all clients.
  return true;
};
