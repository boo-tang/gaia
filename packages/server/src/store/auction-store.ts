// The store does not know the auction rules. The event reducer (indexer/reducer.ts) reads the
// current state with `squares` and `shapes`, and gives the new values of one block to
// `applyBlock`. The store saves them.

import type {
  Address,
  AuctionStatus,
  BidderView,
  EventId,
  Settlement,
  SquareBid,
  StreamMessage,
  Viewport,
} from '@gaia/core';
import { isAddressEqual, type Hex } from 'viem';

/** A block that the store has applied. */
export interface BlockRef {
  number: number;
  hash: Hex;
}

/** The current highest bid on one square. The bidder is the bidder of the shape. */
export interface StoredSquare {
  squareId: number;
  shapeId: number;
  /** Wei. */
  amount: bigint;
}

/** One shape, as the reducer reads and writes it. */
export interface StoredShape {
  shapeId: number;
  bidder: Address;
  block: number;
  timestamp: number;
  /** The squares of the bid, in bid order. */
  bidSquareIds: number[];
  /** The number of bid squares that the shape still holds (`shapeLiveSquares` on chain). */
  heldSquareCount: number;
  /** Not there until the first settlement chunk. */
  settlement: Settlement | undefined;
}

/** All changes of one block. The store applies them in one step. */
export interface BlockChanges {
  block: BlockRef;
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

export interface AuctionStore {
  // --- Indexer ---

  /** The ID of the last applied event, or undefined before the first event. */
  lastEventId(): Promise<EventId | undefined>;
  /** The last applied block (also a block with no event), or undefined when there is none. */
  lastBlock(): Promise<BlockRef | undefined>;
  /**
   * The applied blocks that `undoAfter` can still undo, newest first. The indexer compares
   * their hashes with the chain to find where a reorg starts.
   */
  recentBlocks(): Promise<BlockRef[]>;
  /** Applies the changes, the messages and the block of one block, in one step. */
  applyBlock(changes: BlockChanges): Promise<void>;
  /**
   * Undoes all blocks after block `block` (reorg). Throws `UndoTooDeepError` when a block to
   * undo is older than the undo window; the store is then unchanged.
   */
  undoAfter(block: number): Promise<void>;
  /** Removes all data. The status goes back to the status at the deployment. */
  reset(): Promise<void>;

  // --- Reducer ---

  /** The current bids of these squares. A square with no bid is not in the result. */
  squares(squareIds: readonly number[]): Promise<StoredSquare[]>;
  /** These shapes. An unknown shape is not in the result. */
  shapes(shapeIds: readonly number[]): Promise<StoredShape[]>;
  status(): Promise<AuctionStatus>;

  // --- API ---

  /**
   * The bids in a viewport. Returns at most `limit` bids; when the viewport has more,
   * `complete` is false.
   */
  bidsInViewport(
    viewport: Viewport,
    limit: number,
  ): Promise<{ lastEventId: EventId | undefined; bids: SquareBid[]; complete: boolean }>;
  /** The shapes and the history of a bidder. */
  bidder(address: Address): Promise<StoredBidderView>;
  /** The stored messages after event `after` (all messages when `after` is undefined), in order. */
  messagesAfter(after: EventId | undefined, filter?: MessageFilter): Promise<StreamMessage[]>;
}

export class UndoTooDeepError extends Error {
  constructor(block: number) {
    super(`Cannot undo the blocks after ${block}: they are older than the undo window.`);
    this.name = 'UndoTooDeepError';
  }
}

/** True when `message` passes `filter`. Each store and the live stream use this rule. */
export const messageMatches = (message: StreamMessage, filter: MessageFilter = {}): boolean => {
  const { bidder } = filter;
  if (bidder === undefined) return true;
  if (message.type === 'shapeBid') {
    return isAddressEqual(message.bidder, bidder) || message.taken.some((t) => isAddressEqual(t.bidder, bidder));
  } else if (message.type === 'settlement') {
    return isAddressEqual(message.bidder, bidder);
  }
  // Auction status and reorg messages are for all clients.
  return true;
};
