// The in-memory store: the only store of the MVP. A restart starts with an empty store, and the
// indexer backfills from the deploy block.
//
// For each applied block it keeps the old values of the squares and shapes that the block
// changed, for the last `undoDepth` blocks. `undoAfter` writes them back.

import {
  isBefore,
  type Address,
  type AuctionStatus,
  type Position,
  type Shape,
  type SquareBid,
  type StreamMessage,
  type Viewport,
} from '@gaia/core';

import {
  messageMatches,
  UndoTooDeepError,
  type BlockChanges,
  type BlockRef,
  type MessageFilter,
  type Store,
  type StoredBidderView,
  type StoredShape,
  type StoredSquare,
} from './store';

export interface MemoryStoreOptions {
  /** The position before the first block of the deployment. */
  start: Position;
  /** The status at the deployment (endTime from the deployment file). */
  status: AuctionStatus;
  /** The number of applied blocks that `undoAfter` can undo. */
  undoDepth: number;
}

// The values before one block, for `undoAfter`.
interface Undo {
  block: BlockRef;
  position: Position;
  status: AuctionStatus;
  squares: Map<number, StoredSquare | undefined>;
  shapes: Map<bigint, StoredShape | undefined>;
  messageCount: number;
}

const key = (address: Address) => address.toLowerCase();

export class MemoryStore implements Store {
  private readonly options: MemoryStoreOptions;
  private currentPosition: Position;
  private currentStatus: AuctionStatus;
  private lastBlock: BlockRef | undefined;
  private readonly squareMap = new Map<number, StoredSquare>();
  private readonly shapeMap = new Map<bigint, StoredShape>();
  // Indexes: the live squares of each shape, and the shapes of each bidder.
  private readonly liveSquareIds = new Map<bigint, Set<number>>();
  private readonly bidderShapes = new Map<string, Set<bigint>>();
  private readonly messages: StreamMessage[] = [];
  private undos: Undo[] = [];
  // The newest block that left the undo window.
  private dropped: BlockRef | undefined;

  constructor(options: MemoryStoreOptions) {
    this.options = options;
    this.currentPosition = options.start;
    this.currentStatus = options.status;
  }

  async position() {
    return this.currentPosition;
  }

  async cursor() {
    return this.lastBlock;
  }

  async recentBlocks() {
    return this.undos.map((u) => u.block).reverse();
  }

  async applyBlock(changes: BlockChanges) {
    if (this.lastBlock !== undefined && changes.block.number <= this.lastBlock.number) {
      throw new Error(`Block ${changes.block.number} is not after block ${this.lastBlock.number}.`);
    }
    const undo: Undo = {
      block: changes.block,
      position: this.currentPosition,
      status: this.currentStatus,
      squares: new Map(),
      shapes: new Map(),
      messageCount: this.messages.length,
    };
    for (const square of changes.squares) {
      if (!undo.squares.has(square.squareId)) {
        undo.squares.set(square.squareId, this.squareMap.get(square.squareId));
      }
      this.setSquare(square.squareId, square);
    }
    for (const shape of changes.shapes) {
      if (!undo.shapes.has(shape.shapeId)) undo.shapes.set(shape.shapeId, this.shapeMap.get(shape.shapeId));
      this.setShape(shape.shapeId, shape);
    }
    if (changes.status !== undefined) this.currentStatus = changes.status;
    this.messages.push(...changes.messages);
    this.currentPosition = changes.position;
    this.lastBlock = changes.block;
    this.undos.push(undo);
    if (this.undos.length > this.options.undoDepth) this.dropped = this.undos.shift()?.block;
  }

  async undoAfter(block: number) {
    if (this.lastBlock === undefined || this.lastBlock.number <= block) return;
    // A block that left the undo window cannot be undone.
    if (this.dropped !== undefined && this.dropped.number > block) throw new UndoTooDeepError(block);
    while (this.undos.length > 0 && this.undos[this.undos.length - 1].block.number > block) {
      const undo = this.undos.pop() as Undo;
      for (const [squareId, square] of undo.squares) this.setSquare(squareId, square);
      for (const [shapeId, shape] of undo.shapes) this.setShape(shapeId, shape);
      this.currentStatus = undo.status;
      this.currentPosition = undo.position;
      this.messages.length = undo.messageCount;
    }
    this.lastBlock = this.undos.length > 0 ? this.undos[this.undos.length - 1].block : this.dropped;
  }

  async reset() {
    this.currentPosition = this.options.start;
    this.currentStatus = this.options.status;
    this.lastBlock = undefined;
    this.squareMap.clear();
    this.shapeMap.clear();
    this.liveSquareIds.clear();
    this.bidderShapes.clear();
    this.messages.length = 0;
    this.undos = [];
    this.dropped = undefined;
  }

  async squares(squareIds: readonly number[]) {
    const result: StoredSquare[] = [];
    for (const id of squareIds) {
      const square = this.squareMap.get(id);
      if (square !== undefined) result.push(square);
    }
    return result;
  }

  async shapes(shapeIds: readonly bigint[]) {
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
        shapeId: square.shapeId.toString(),
        bidder: shape.bidder,
        amount: square.amount.toString(),
      });
    }
    return { position: this.currentPosition, bids, complete };
  }

  async bidder(address: Address): Promise<StoredBidderView> {
    const ids = [...(this.bidderShapes.get(key(address)) ?? [])].sort((a, b) => (a < b ? -1 : 1));
    const shapes: Shape[] = ids.map((id) => {
      const shape = this.shapeMap.get(id) as StoredShape;
      const live = this.liveSquareIds.get(id) ?? new Set<number>();
      return {
        shapeId: id.toString(),
        bidder: shape.bidder,
        block: shape.block,
        timestamp: shape.timestamp,
        squareIds: shape.squareIds,
        liveSquareIds: shape.squareIds.filter((s) => live.has(s)),
        settledSquares: shape.settledSquares,
        countryId: shape.countryId === 0n ? undefined : shape.countryId.toString(),
        settled: shape.settled,
      };
    });
    const history = this.messages.filter(
      (m) => m.type !== 'auctionStatus' && messageMatches(m, { bidder: address }),
    );
    return { position: this.currentPosition, bidder: address, shapes, history };
  }

  async messagesAfter(after: Position, filter: MessageFilter = {}) {
    // Binary search for the first message after `after`.
    let lo = 0;
    let hi = this.messages.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (isBefore(after, this.messages[mid].position)) hi = mid;
      else lo = mid + 1;
    }
    return this.messages.slice(lo).filter((m) => messageMatches(m, filter));
  }

  private setSquare(squareId: number, square: StoredSquare | undefined) {
    const old = this.squareMap.get(squareId);
    if (old !== undefined) this.liveSquareIds.get(old.shapeId)?.delete(squareId);
    if (square === undefined) {
      this.squareMap.delete(squareId);
      return;
    }
    this.squareMap.set(squareId, square);
    let live = this.liveSquareIds.get(square.shapeId);
    if (live === undefined) {
      live = new Set();
      this.liveSquareIds.set(square.shapeId, live);
    }
    live.add(squareId);
  }

  private setShape(shapeId: bigint, shape: StoredShape | undefined) {
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
