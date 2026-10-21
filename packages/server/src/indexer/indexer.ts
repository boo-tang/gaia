// The event loop. Each step:
// 1. Compares the hash of the store cursor with the chain. When they differ (reorg), it finds the
//    newest applied block that the chain still has, undoes the blocks after it, and sends a reorg
//    message. When no block of the undo window matches, it clears the store (a new backfill).
// 2. Gets the auction events from the block after the cursor to the chain head, in ranges of
//    `logRange` blocks (the backfill is the same loop from the deploy block).
// 3. Applies each block with events in (block, log index) order: reducer, then one
//    `applyBlock`, then the live messages. Then it applies the head block (with no events), so
//    that the cursor and its hash follow the head.
//
// The steps never run at the same time: `syncOnce` waits for the step before it.
//
// More contracts (land, sale, market: milestone 2) add their events to `fetchEvents` and their
// rules to the reducer; the loop stays the same.

import type { Address } from '@gaia/core';
import type { PublicClient } from 'viem';

import { blockHashAt, fetchAuctionEvents, type ChainEvent } from '../chain';
import type { Hub } from '../live';
import { UndoTooDeepError, type Store } from '../store/store';
import type { AuctionEvent } from './events';
import { reduceBlock } from './reducer';

export interface IndexerOptions {
  client: PublicClient;
  store: Store;
  hub: Hub;
  auction: Address;
  deployBlock: number;
  logRange: number;
  pollIntervalMs: number;
  log?: (message: string) => void;
}

export class Indexer {
  private readonly o: IndexerOptions;
  private queue: Promise<void> = Promise.resolve();
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(options: IndexerOptions) {
    this.o = options;
  }

  /** Runs one step of the loop, after the step that runs now (if any). */
  syncOnce(): Promise<void> {
    const step = this.queue.then(() => this.sync());
    this.queue = step.catch(() => undefined);
    return step;
  }

  /** Polls the chain every `pollIntervalMs`. An error is logged; the next poll tries again. */
  start() {
    if (this.running) return;
    this.running = true;
    const tick = async () => {
      try {
        await this.syncOnce();
      } catch (error) {
        this.log(`Indexer step failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (this.running) this.timer = setTimeout(tick, this.o.pollIntervalMs);
    };
    void tick();
  }

  /** Stops the polls and waits for the step that runs now. */
  async stop() {
    this.running = false;
    if (this.timer !== undefined) clearTimeout(this.timer);
    await this.queue;
  }

  private log(message: string) {
    (this.o.log ?? console.log)(message);
  }

  private async sync() {
    const { client, store } = this.o;
    if (await this.reorged()) return;

    const head = Number(await client.getBlockNumber());
    const cursor = await store.cursor();
    let from = cursor === undefined ? this.o.deployBlock : cursor.number + 1;
    if (from > head) return;

    while (from <= head) {
      const to = Math.min(from + this.o.logRange - 1, head);
      const events = await fetchAuctionEvents(client, this.o.auction, from, to);
      for (const group of groupByBlock(events)) await this.apply(group);
      from = to + 1;
    }

    // Move the cursor to the head, so that the next step checks the head hash.
    const last = await store.cursor();
    if (last === undefined || last.number < head) {
      const block = await client.getBlock({ blockNumber: BigInt(head) });
      if (block.hash === null) return;
      await this.applyBlock(head, block.hash, Number(block.timestamp), []);
    }
  }

  private async apply(group: ChainEvent[]) {
    const { blockNumber, blockHash } = group[0];
    let timestamp = group[0].blockTimestamp;
    if (timestamp === undefined) {
      timestamp = Number((await this.o.client.getBlock({ blockHash })).timestamp);
    }
    await this.applyBlock(blockNumber, blockHash, timestamp, group.map((e) => e.event));
  }

  private async applyBlock(number: number, hash: `0x${string}`, timestamp: number, events: AuctionEvent[]) {
    const changes = await reduceBlock(this.o.store, { block: { number, hash }, timestamp, events });
    await this.o.store.applyBlock(changes);
    this.o.hub.publish(changes.messages);
  }

  // True when the chain no longer has the cursor block. Then undoes the dropped blocks.
  private async reorged(): Promise<boolean> {
    const { client, store, hub } = this.o;
    const cursor = await store.cursor();
    if (cursor === undefined) return false;
    if ((await blockHashAt(client, cursor.number)) === cursor.hash) return false;

    for (const block of await store.recentBlocks()) {
      if ((await blockHashAt(client, block.number)) !== block.hash) continue;
      try {
        await store.undoAfter(block.number);
        this.log(`Reorg: undid the blocks after ${block.number}.`);
      } catch (error) {
        if (!(error instanceof UndoTooDeepError)) throw error;
        await store.reset();
        this.log('Reorg deeper than the undo window: cleared the store, backfill again.');
      }
      hub.publish([{ type: 'reorg', position: await store.position() }]);
      return true;
    }
    await store.reset();
    this.log('Reorg deeper than the undo window: cleared the store, backfill again.');
    hub.publish([{ type: 'reorg', position: await store.position() }]);
    return true;
  }
}

const groupByBlock = (events: ChainEvent[]): ChainEvent[][] => {
  const groups: ChainEvent[][] = [];
  for (const event of events) {
    const last = groups[groups.length - 1];
    if (last !== undefined && last[0].blockNumber === event.blockNumber) last.push(event);
    else groups.push([event]);
  }
  return groups;
};
