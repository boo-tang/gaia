// The in-memory store: the only store of the MVP. A restart starts with an empty store, and the
// indexer backfills from the deploy block.

import {
  isBefore,
  type Address,
  type AuctionStatus,
  type EventId,
  type Shape,
  type SquareBid,
  type StreamMessage,
  type Viewport,
} from '@gaia/core';

import {
  messageMatches,
  UndoTooDeepError,
  type AuctionStore,
  type BlockChanges,
  type BlockRef,
  type MessageFilter,
  type StoredBidderView,
  type StoredShape,
  type StoredSquare,
} from './auction-store';

export interface MemoryAuctionStoreOptions {
  /** The status at the deployment (endTime from the deployment file). */
  status: AuctionStatus;
  /** The number of applied blocks that `undoAfter` can undo. */
  undoDepth: number;
}

/**
 * One applied block, with the values that it replaced. `undoAfter` writes these values back.
 * An undefined square or shape did not exist before the block.
 */
interface AppliedBlock {
  block: BlockRef;
  before: {
    lastEventId: EventId | undefined;
    status: AuctionStatus;
    squares: Map<number, StoredSquare | undefined>;
    shapes: Map<number, StoredShape | undefined>;
    messageCount: number;
  };
}

const key = (address: Address) => address.toLowerCase();

export class MemoryAuctionStore implements AuctionStore {
  private readonly options: MemoryAuctionStoreOptions;
  private currentLastEventId: EventId | undefined;
  private currentStatus: AuctionStatus;
  private currentLastBlock: BlockRef | undefined;
  private readonly squareMap = new Map<number, StoredSquare>();
  private readonly shapeMap = new Map<number, StoredShape>();
  // Indexes: the held squares of each shape, and the shapes of each bidder.
  private readonly heldSquareIds = new Map<number, Set<number>>();
  private readonly bidderShapes = new Map<string, Set<number>>();
  private readonly messages: StreamMessage[] = [];
  // The last `undoDepth` applied blocks, oldest first.
  private appliedBlocks: AppliedBlock[] = [];
  // The newest block that left `appliedBlocks`. It cannot be undone.
  private droppedBlock: BlockRef | undefined;

  constructor(options: MemoryAuctionStoreOptions) {
    this.options = options;
    this.currentStatus = options.status;
  }

  async lastEventId() {
    return this.currentLastEventId;
  }

  async lastBlock() {
    return this.currentLastBlock;
  }

  async recentBlocks() {
    return this.appliedBlocks.map((a) => a.block).reverse();
  }

  async applyBlock(changes: BlockChanges) {
    if (this.currentLastBlock !== undefined && changes.block.number <= this.currentLastBlock.number) {
      throw new Error(`Block ${changes.block.number} is not after block ${this.currentLastBlock.number}.`);
    }
    const applied: AppliedBlock = {
      block: changes.block,
      before: {
        lastEventId: this.currentLastEventId,
        status: this.currentStatus,
        squares: new Map(),
        shapes: new Map(),
        messageCount: this.messages.length,
      },
    };
    for (const square of changes.squares) {
      if (!applied.before.squares.has(square.squareId)) {
        applied.before.squares.set(square.squareId, this.squareMap.get(square.squareId));
      }
      this.setSquare(square.squareId, square);
    }
    for (const shape of changes.shapes) {
      if (!applied.before.shapes.has(shape.shapeId)) {
        applied.before.shapes.set(shape.shapeId, this.shapeMap.get(shape.shapeId));
      }
      this.setShape(shape.shapeId, shape);
    }
    if (changes.status !== undefined) this.currentStatus = changes.status;
    this.messages.push(...changes.messages);
    const lastMessage = changes.messages[changes.messages.length - 1];
    if (lastMessage !== undefined && lastMessage.type !== 'reorg') this.currentLastEventId = lastMessage.id;
    this.currentLastBlock = changes.block;
    this.appliedBlocks.push(applied);
    if (this.appliedBlocks.length > this.options.undoDepth) this.droppedBlock = this.appliedBlocks.shift()?.block;
  }

  async undoAfter(block: number) {
    if (this.currentLastBlock === undefined || this.currentLastBlock.number <= block) return;
    if (this.droppedBlock !== undefined && this.droppedBlock.number > block) throw new UndoTooDeepError(block);
    while (this.appliedBlocks.length > 0 && this.appliedBlocks[this.appliedBlocks.length - 1].block.number > block) {
      const { before } = this.appliedBlocks.pop() as AppliedBlock;
      for (const [squareId, square] of before.squares) this.setSquare(squareId, square);
      for (const [shapeId, shape] of before.shapes) this.setShape(shapeId, shape);
      this.currentStatus = before.status;
      this.currentLastEventId = before.lastEventId;
      this.messages.length = before.messageCount;
    }
    const newest = this.appliedBlocks[this.appliedBlocks.length - 1];
    this.currentLastBlock = newest === undefined ? this.droppedBlock : newest.block;
  }

  async reset() {
    this.currentLastEventId = undefined;
    this.currentStatus = this.options.status;
    this.currentLastBlock = undefined;
    this.squareMap.clear();
    this.shapeMap.clear();
    this.heldSquareIds.clear();
    this.bidderShapes.clear();
    this.messages.length = 0;
    this.appliedBlocks = [];
    this.droppedBlock = undefined;
  }

  async squares(squareIds: readonly number[]) {
    const result: StoredSquare[] = [];
    for (const id of squareIds) {
      const square = this.squareMap.get(id);
      if (square !== undefined) result.push(square);
    }
    return result;
  }

  async shapes(shapeIds: readonly number[]) {
    const result: StoredShape[] = [];
    for (const id of shapeIds) {
      const shape = this.shapeMap.get(id);
      if (shape !== undefined) result.push(shape);
    }
    return result;
  }

  async status() {
    return this.currentStatus;
  }

  async bidsInViewport(viewport: Viewport, limit: number) {
    const { south, north, west, east } = viewport;
    const bids: SquareBid[] = [];
    let complete = true;
    for (const square of this.squareMap.values()) {
      const lat = Math.floor(square.squareId / 65536);
      const lng = square.squareId % 65536;
      if (lat < south || lat > north) continue;
      const inColumns = west <= east ? lng >= west && lng <= east : lng >= west || lng <= east;
      if (!inColumns) continue;
      if (bids.length === limit) {
        complete = false;
        break;
      }
      const shape = this.shapeMap.get(square.shapeId) as StoredShape;
      bids.push({
        squareId: square.squareId,
        shapeId: square.shapeId,
        bidder: shape.bidder,
        amount: square.amount.toString(),
      });
    }
    return { lastEventId: this.currentLastEventId, bids, complete };
  }

  async bidder(address: Address): Promise<StoredBidderView> {
    const ids = [...(this.bidderShapes.get(key(address)) ?? [])].sort((a, b) => a - b);
    const shapes: Shape[] = ids.map((id) => {
      const shape = this.shapeMap.get(id) as StoredShape;
      const held = this.heldSquareIds.get(id) ?? new Set<number>();
      return {
        shapeId: id,
        bidder: shape.bidder,
        block: shape.block,
        timestamp: shape.timestamp,
        bidSquareIds: shape.bidSquareIds,
        heldSquareIds: shape.bidSquareIds.filter((s) => held.has(s)),
        settlement: shape.settlement,
      };
    });
    const history = this.messages.filter(
      (m) => m.type !== 'auctionStatus' && messageMatches(m, { bidder: address }),
    );
    return { lastEventId: this.currentLastEventId, bidder: address, shapes, history };
  }

  async messagesAfter(after: EventId | undefined, filter: MessageFilter = {}) {
    // Binary search for the first message after `after`.
    let lo = 0;
    let hi = this.messages.length;
    if (after !== undefined) {
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        const message = this.messages[mid];
        if (message.type !== 'reorg' && isBefore(after, message.id)) hi = mid;
        else lo = mid + 1;
      }
    }
    return this.messages.slice(lo).filter((m) => messageMatches(m, filter));
  }

  private setSquare(squareId: number, square: StoredSquare | undefined) {
    const old = this.squareMap.get(squareId);
    if (old !== undefined) this.heldSquareIds.get(old.shapeId)?.delete(squareId);
    if (square === undefined) {
      this.squareMap.delete(squareId);
      return;
    }
    this.squareMap.set(squareId, square);
    let held = this.heldSquareIds.get(square.shapeId);
    if (held === undefined) {
      held = new Set();
      this.heldSquareIds.set(square.shapeId, held);
    }
    held.add(squareId);
  }

  private setShape(shapeId: number, shape: StoredShape | undefined) {
    const old = this.shapeMap.get(shapeId);
    if (shape === undefined) {
      this.shapeMap.delete(shapeId);
      if (old !== undefined) this.bidderShapes.get(key(old.bidder))?.delete(shapeId);
      return;
    }
    this.shapeMap.set(shapeId, shape);
    let set = this.bidderShapes.get(key(shape.bidder));
    if (set === undefined) {
      set = new Set();
      this.bidderShapes.set(key(shape.bidder), set);
    }
    set.add(shapeId);
  }
}
