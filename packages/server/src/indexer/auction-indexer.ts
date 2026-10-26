// The event loop. Each step:
// 1. Gets the head block (one call). When the head is older than the last applied block, the node
//    that answered is behind: the step ends.
// 2. Checks that the chain still has the last applied block: the head is that block, or its parent
//    hash is that block. Only when blocks lie between them does it read the hash of the last applied
//    block (a node that does not have it yet is behind: the step ends). When the hashes differ
//    (reorg), it finds the newest applied block that the chain still has, undoes the blocks after
//    it, and sends a reorg message. When no block of the undo window matches, it clears the store
//    (a new backfill).
// 3. Gets the auction events from the block after the last applied block to the head, in ranges of
//    `logRange` blocks (the backfill is the same loop from the deploy block).
// 4. Applies each block with events in (block, log index) order: reducer, then one
//    `applyBlock`, then the live messages. Then it applies the head block (with no events), so
//    that the last applied block follows the head.
//
// The steps never run at the same time: `syncOnce` waits for the step before it.
//
// More contracts (land, sale, market: milestone 2) add their events to `fetchEvents` and their
// rules to the reducer; the loop stays the same.
import type { Address } from '@gaia/core';

import type { GetBlockReturnType, PublicClient } from 'viem';

import { type AuctionEventLog, fetchAuctionEvents, readBlockHash } from '../auction-rpc';
import type { LiveMessageBus } from '../live-message-bus';
import { type AuctionStore, type BlockNumberAndHash, UndoWindowExceededError } from '../store/auction-store';
import type { AuctionEvent } from './auction-events';
import { reduceAuctionBlock } from './auction-reducer';

type HeadBlock = GetBlockReturnType<undefined, false, 'latest'>;

export interface AuctionIndexerOptions {
  client: PublicClient;
  store: AuctionStore;
  liveMessageBus: LiveMessageBus;
  auction: Address;
  deployBlock: number;
  logRange: number;
  pollIntervalMs: number;
  log?: (message: string) => void;
}

export class AuctionIndexer {
  private readonly o: AuctionIndexerOptions;
  private queue: Promise<void> = Promise.resolve();
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(options: AuctionIndexerOptions) {
    this.o = options;
  }

  /** Runs one step of the loop, after the step that runs now (if any). */
  syncOnce(): Promise<void> {
    const step = this.queue.then(() => this.syncToHead());
    this.queue = step.catch(() => undefined);
    return step;
  }

  /** Polls the chain every `pollIntervalMs`. An error is logged; the next poll tries again. */
  start() {
    if (this.running) {
      return;
    }
    this.running = true;
    const tick = async () => {
      try {
        await this.syncOnce();
      } catch (error) {
        this.log(`AuctionIndexer step failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (this.running) {
        this.timer = setTimeout(() => void tick(), this.o.pollIntervalMs);
      }
    };
    void tick();
  }

  /** Stops the polls and waits for the step that runs now. */
  async stop() {
    this.running = false;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
    }
    await this.queue;
  }

  private log(message: string) {
    (this.o.log ?? console.log)(message);
  }

  private async syncToHead() {
    const { client, store } = this.o;
    const headBlock = await client.getBlock({ blockTag: 'latest' });
    const head = Number(headBlock.number);
    const lastBlock = await store.lastBlock();
    if (lastBlock !== undefined) {
      if (head < lastBlock.number || !(await this.chainHasBlock(lastBlock, headBlock))) {
        return;
      }
    }

    let from = lastBlock === undefined ? this.o.deployBlock : lastBlock.number + 1;
    if (from > head) {
      return;
    }

    while (from <= head) {
      const to = Math.min(from + this.o.logRange - 1, head);
      const events = await fetchAuctionEvents(client, this.o.auction, from, to);
      for (const group of groupEventLogsByBlock(events)) {
        await this.apply(group);
      }
      from = to + 1;
    }

    // Apply the head block, so that the next step checks the head hash.
    const last = await store.lastBlock();
    if (last === undefined || last.number < head) {
      await this.applyBlock(head, headBlock.hash, Number(headBlock.timestamp), []);
    }
  }

  private async apply(group: AuctionEventLog[]) {
    const { blockNumber, blockHash } = group[0];
    let timestamp = group[0].blockTimestamp;
    if (timestamp === undefined) {
      timestamp = Number((await this.o.client.getBlock({ blockHash })).timestamp);
    }
    await this.applyBlock(
      blockNumber,
      blockHash,
      timestamp,
      group.map(e => e.event),
    );
  }

  private async applyBlock(number: number, hash: `0x${string}`, timestamp: number, events: AuctionEvent[]) {
    const changes = await reduceAuctionBlock(this.o.store, { block: { number, hash }, timestamp, events });
    await this.o.store.applyBlock(changes);
    this.o.liveMessageBus.publish(changes.messages);
  }

  // True when the chain still has the last applied block. False when the node is behind (no undo),
  // or after a reorg (the dropped blocks are undone): then the step ends.
  private async chainHasBlock(lastBlock: BlockNumberAndHash, head: HeadBlock): Promise<boolean> {
    if (head.number === BigInt(lastBlock.number)) {
      if (head.hash === lastBlock.hash) {
        return true;
      }
    } else if (head.number === BigInt(lastBlock.number + 1) && head.parentHash === lastBlock.hash) {
      return true;
    } else {
      const hash = await readBlockHash(this.o.client, lastBlock.number);
      if (hash === lastBlock.hash) {
        return true;
      }
      if (hash === undefined) {
        return false;
      }
    }
    await this.undoReorgedBlocks();
    return false;
  }

  // Undoes the blocks that the chain no longer has.
  private async undoReorgedBlocks() {
    const { client, store, liveMessageBus } = this.o;
    for (const block of await store.recentBlocks()) {
      if ((await readBlockHash(client, block.number)) !== block.hash) {
        continue;
      }
      try {
        await store.undoAfter(block.number);
        this.log(`Reorg: undid the blocks after ${block.number}.`);
      } catch (error) {
        if (!(error instanceof UndoWindowExceededError)) {
          throw error;
        }
        await store.reset();
        this.log('Reorg deeper than the undo window: cleared the store, backfill again.');
      }
      liveMessageBus.publish([{ type: 'reorg', lastEventId: await store.lastEventId() }]);
      return;
    }
    await store.reset();
    this.log('Reorg deeper than the undo window: cleared the store, backfill again.');
    liveMessageBus.publish([{ type: 'reorg', lastEventId: await store.lastEventId() }]);
  }
}

const groupEventLogsByBlock = (events: AuctionEventLog[]): AuctionEventLog[][] => {
  const groups: AuctionEventLog[][] = [];
  for (const event of events) {
    const last = groups[groups.length - 1];
    if (last !== undefined && last[0].blockNumber === event.blockNumber) {
      last.push(event);
    } else {
      groups.push([event]);
    }
  }
  return groups;
};
